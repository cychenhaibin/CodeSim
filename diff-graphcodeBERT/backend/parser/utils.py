"""
代码预处理工具函数

移植自 GraphCodeBERT 官方实现:
https://github.com/microsoft/CodeBERT/blob/master/GraphCodeBERT/clonedetection/parser/utils.py
"""

import re
import tokenize
from io import StringIO
from typing import List, Tuple, Dict

from tree_sitter import Node


def remove_comments_and_docstrings(source: str, lang: str) -> str:
    """
    去除代码中的注释和文档字符串

    Python 使用 tokenize 词法分析精确识别注释和文档字符串；
    C/Java/JS/Go 等使用正则同时匹配注释和字符串字面量，
    通过 replacer 函数只删除注释、保留字符串（避免误删字符串中的 // 等）。
    """
    if lang == 'python':
        return _remove_python_comments(source)
    elif lang == 'ruby':
        return source
    else:
        return _remove_c_style_comments(source)


def _remove_python_comments(source: str) -> str:
    """使用 tokenize 词法分析去除 Python 注释和文档字符串"""
    try:
        io_obj = StringIO(source)
        out = ""
        prev_toktype = tokenize.INDENT
        last_lineno = -1
        last_col = 0
        for tok in tokenize.generate_tokens(io_obj.readline):
            token_type = tok[0]
            token_string = tok[1]
            start_line, start_col = tok[2]
            end_line, end_col = tok[3]
            if start_line > last_lineno:
                last_col = 0
            if start_col > last_col:
                out += (" " * (start_col - last_col))
            if token_type == tokenize.COMMENT:
                pass
            elif token_type == tokenize.STRING:
                if prev_toktype != tokenize.INDENT:
                    if prev_toktype != tokenize.NEWLINE:
                        if start_col > 0:
                            out += token_string
            else:
                out += token_string
            prev_toktype = token_type
            last_col = end_col
            last_lineno = end_line
        return '\n'.join(x for x in out.split('\n') if x.strip())
    except Exception:
        return source


def _remove_c_style_comments(source: str) -> str:
    """
    使用正则去除 C 风格注释 (// 和 /* */)

    正则同时匹配四种模式: 单行注释、多行注释、单引号字符串、双引号字符串。
    replacer 判断匹配结果是否以 / 开头来区分注释和字符串，
    只删除注释、保留字符串，从而避免误删字符串内的 // 或 /* 等内容。
    """
    def replacer(match):
        s = match.group(0)
        if s.startswith('/'):
            return " "
        else:
            return s

    pattern = re.compile(
        r'//.*?$|/\*.*?\*/|\'(?:\\.|[^\\\'])*\'|"(?:\\.|[^\\"])*"',
        re.DOTALL | re.MULTILINE
    )
    return '\n'.join(x for x in re.sub(pattern, replacer, source).split('\n') if x.strip())


def tree_to_token_index(root_node: Node) -> List[Tuple]:
    """将 AST 叶子节点映射到 (start_point, end_point) 列表"""
    if (len(root_node.children) == 0 or root_node.type == 'string') and root_node.type != 'comment':
        return [(root_node.start_point, root_node.end_point)]
    code_tokens = []
    for child in root_node.children:
        code_tokens += tree_to_token_index(child)
    return code_tokens


def tree_to_variable_index(root_node: Node, index_to_code: Dict) -> List[Tuple]:
    """提取节点中的变量索引"""
    if (len(root_node.children) == 0 or root_node.type == 'string') and root_node.type != 'comment':
        index = (root_node.start_point, root_node.end_point)
        if index in index_to_code:
            _, code = index_to_code[index]
            if root_node.type != code:
                return [index]
        return []
    code_tokens = []
    for child in root_node.children:
        code_tokens += tree_to_variable_index(child, index_to_code)
    return code_tokens


def index_to_code_token(index, code_lines: List[str]) -> str:
    """将 (start_point, end_point) 映射为代码字符串"""
    start_point = index[0]
    end_point = index[1]
    if start_point[0] == end_point[0]:
        s = code_lines[start_point[0]][start_point[1]:end_point[1]]
    else:
        s = code_lines[start_point[0]][start_point[1]:]
        for i in range(start_point[0] + 1, end_point[0]):
            s += code_lines[i]
        s += code_lines[end_point[0]][:end_point[1]]
    return s
