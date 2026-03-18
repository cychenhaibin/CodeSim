"""
代码解析器包

官方代码: https://github.com/microsoft/CodeBERT/tree/master/GraphCodeBERT/clonedetection/parser

适配 py-tree-sitter >= 0.23 的新 API。
支持语言：Python, Java, C/C++, JavaScript, Go, Ruby
"""

from typing import List, Tuple, Dict, Optional, Callable

from tree_sitter import Language, Parser

from .DFG import (
    DFG_python, DFG_java, DFG_c, DFG_javascript, DFG_go, DFG_ruby,
)
from .utils import (
    remove_comments_and_docstrings,
    tree_to_token_index,
    tree_to_variable_index,
    index_to_code_token,
)


# 语言加载

_LANGUAGE_CACHE: Dict[str, Language] = {}
_PARSER_CACHE: Dict[str, Parser] = {}

_LANG_CONFIG = {
    'python':     ('tree_sitter_python',     DFG_python),
    'java':       ('tree_sitter_java',       DFG_java),
    'c':          ('tree_sitter_c',          DFG_c),
    'cpp':        ('tree_sitter_c',          DFG_c),
    'javascript': ('tree_sitter_javascript', DFG_javascript),
    'go':         ('tree_sitter_go',         DFG_go),
    'ruby':       ('tree_sitter_ruby',       DFG_ruby),
}


def _load_language(lang: str) -> Optional[Language]:
    """动态加载 tree-sitter 语言"""
    if lang in _LANGUAGE_CACHE:
        return _LANGUAGE_CACHE[lang]

    config = _LANG_CONFIG.get(lang)
    if config is None:
        return None

    module_name = config[0]
    try:
        import importlib
        mod = importlib.import_module(module_name)
        language = Language(mod.language())
        _LANGUAGE_CACHE[lang] = language
        return language
    except (ImportError, Exception) as e:
        print(f"加载 {module_name} 失败: {e}")
        return None


def _get_parser(lang: str) -> Optional[Parser]:
    """获取指定语言的 parser"""
    if lang in _PARSER_CACHE:
        return _PARSER_CACHE[lang]
    language = _load_language(lang)
    if language is None:
        return None
    parser = Parser(language)
    _PARSER_CACHE[lang] = parser
    return parser


# 对外接口

class TreeSitterDFGExtractor:
    """
    基于 tree-sitter 的数据流图提取器

    使用精确的语法分析提取变量的定义-使用关系，
    移植自 GraphCodeBERT 官方实现。
    """

    def __init__(self, lang: str = 'c'):
        self.lang = lang
        self.parser = _get_parser(lang)
        config = _LANG_CONFIG.get(lang)
        self.dfg_func: Optional[Callable] = config[1] if config else None

    def is_available(self) -> bool:
        return self.parser is not None and self.dfg_func is not None

    def extract_dfg(self, code: str) -> List[Tuple[str, int, str, List[int]]]:
        """
        提取数据流图

        返回格式:
        [(变量名, 位置索引, 类型, 依赖的位置列表), ...]
        """
        if not self.is_available():
            return []

        tree = self.parser.parse(bytes(code, 'utf-8'))
        root_node = tree.root_node

        code_lines = code.split('\n')
        token_indexes = tree_to_token_index(root_node)
        index_to_code = {}
        for idx, index in enumerate(token_indexes):
            try:
                code_token = index_to_code_token(index, code_lines)
                index_to_code[index] = (idx, code_token)
            except (IndexError, KeyError):
                continue

        dfg_raw, _ = self.dfg_func(root_node, index_to_code, {})

        dfg = []
        for item in dfg_raw:
            if len(item) >= 5:
                var_name, idx, edge_type, _, dep_indices = item
                dfg.append((var_name, idx, edge_type, dep_indices))
            elif len(item) >= 4:
                dfg.append(item)
        return dfg

    def get_dfg_tokens(self, code: str) -> Tuple[List[str], List[Tuple]]:
        """获取代码 tokens 和 DFG"""
        if not self.is_available():
            return [], []

        tree = self.parser.parse(bytes(code, 'utf-8'))
        root_node = tree.root_node
        code_lines = code.split('\n')

        token_indexes = tree_to_token_index(root_node)
        code_tokens = []
        index_to_code = {}
        for idx, index in enumerate(token_indexes):
            try:
                code_token = index_to_code_token(index, code_lines)
                code_tokens.append(code_token)
                index_to_code[index] = (idx, code_token)
            except (IndexError, KeyError):
                continue

        dfg_raw, _ = self.dfg_func(root_node, index_to_code, {})

        dfg = []
        for item in dfg_raw:
            if len(item) >= 5:
                var_name, idx, edge_type, _, dep_indices = item
                dfg.append((var_name, idx, edge_type, dep_indices))
            elif len(item) >= 4:
                dfg.append(item)

        return code_tokens, dfg


def is_tree_sitter_available(lang: str = 'c') -> bool:
    """检查指定语言的 tree-sitter 是否可用"""
    return _get_parser(lang) is not None
