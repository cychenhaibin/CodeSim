"""
代码标准化预处理模块

在相似度比较前，抹掉"无关修改"：
- 移除 console.log/warn/debug/error 等调试语句
- 移除 debugger 语句
- CSS 属性值归一化（颜色、尺寸等替换为占位符）
- 变量名/函数名归一化（alpha-rename）
- 移除注释
"""

import re
from typing import Dict, Set

# 保留的标识符（不做重命名）
RESERVED_NAMES: Set[str] = {
    'React', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
    'useContext', 'useReducer', 'useLayoutEffect',
    'Component', 'PureComponent', 'Fragment',
    'console', 'window', 'document', 'module', 'exports', 'require',
    'import', 'export', 'default', 'from', 'as', 'return', 'if', 'else',
    'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof',
    'instanceof', 'in', 'of', 'void', 'let', 'const', 'var', 'function',
    'class', 'extends', 'async', 'await', 'yield', 'static', 'get', 'set',
    'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Date', 'RegExp',
    'Error', 'TypeError', 'RangeError', 'JSON', 'Math', 'parseInt', 'parseFloat',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'fetch', 'Request', 'Response', 'Headers', 'URL',
    'undefined', 'null', 'NaN', 'Infinity', 'true', 'false',
    'props', 'state', 'children', 'className', 'style', 'key', 'ref',
    'this', 'super', 'self', 'process', 'global', 'Buffer',
    'e', 'event', 'err', 'error', 'i', 'j', 'k', 'n', 'x', 'y',
}

# CSS 属性名
CSS_PROPERTIES: Set[str] = {
    'color', 'background-color', 'background', 'border', 'border-color',
    'border-radius', 'border-width', 'margin', 'margin-top', 'margin-bottom',
    'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
    'padding-left', 'padding-right', 'width', 'height', 'min-width', 'max-width',
    'min-height', 'max-height', 'font-size', 'font-weight', 'line-height',
    'letter-spacing', 'text-align', 'display', 'flex', 'flex-direction',
    'justify-content', 'align-items', 'gap', 'top', 'bottom', 'left', 'right',
    'z-index', 'opacity', 'overflow', 'position', 'transform', 'transition',
    'box-shadow', 'text-decoration', 'cursor', 'outline',
    # camelCase 版本
    'backgroundColor', 'borderColor', 'borderRadius', 'borderWidth',
    'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
    'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
    'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
    'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'textAlign', 'flexDirection', 'justifyContent', 'alignItems',
    'zIndex', 'boxShadow', 'textDecoration',
}

# CSS 值模式
CSS_VALUE_PATTERN = re.compile(
    r'^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|s|ms|deg)?)$'
)


def normalize_code(code: str, lang: str = 'javascript') -> str:
    """
    对代码做标准化预处理
    
    1. 移除注释
    2. 移除 console.xxx() 调试语句
    3. 移除 debugger
    4. CSS 属性值归一化
    5. 变量名/函数名归一化
    """
    result = code
    
    # 1. 移除注释
    result = _remove_comments(result, lang)
    
    # 2. 移除 console.xxx(...) 整行
    result = _remove_console_statements(result)
    
    # 3. 移除 debugger
    result = re.sub(r'^\s*debugger\s*;?\s*$', '', result, flags=re.MULTILINE)
    
    # 4. CSS 值归一化
    result = _normalize_css_values(result)
    
    # 5. 变量名归一化
    result = _normalize_identifiers(result)
    
    # 清理空行
    result = '\n'.join(line for line in result.split('\n') if line.strip())
    
    return result


def _remove_comments(code: str, lang: str) -> str:
    """移除注释"""
    if lang == 'python':
        code = re.sub(r'#.*$', '', code, flags=re.MULTILINE)
        code = re.sub(r'"""[\s\S]*?"""', '""', code)
        code = re.sub(r"'''[\s\S]*?'''", "''", code)
    else:
        def replacer(match):
            s = match.group(0)
            if s.startswith('/'):
                return ' '
            return s
        code = re.sub(
            r'//.*?$|/\*[\s\S]*?\*/|\'(?:\\.|[^\\\'])*\'|"(?:\\.|[^\\"])*"',
            replacer, code, flags=re.MULTILINE
        )
    return code


def _remove_console_statements(code: str) -> str:
    """移除 console.log/warn/debug/error/info/trace 整行"""
    return re.sub(
        r'^\s*console\.(log|warn|debug|error|info|trace)\s*\([^)]*\)\s*;?\s*$',
        '',
        code,
        flags=re.MULTILINE
    )


def _normalize_css_values(code: str) -> str:
    """归一化 CSS 属性值"""
    for prop in CSS_PROPERTIES:
        # 匹配 property: 'value' 或 property: "value" 模式
        pattern = re.compile(
            rf"""({re.escape(prop)}\s*:\s*)(['"])([^'"]*)\2""",
        )
        def replacer(m):
            val = m.group(3)
            if CSS_VALUE_PATTERN.match(val):
                return f"{m.group(1)}{m.group(2)}_CSS_{m.group(2)}"
            return m.group(0)
        code = pattern.sub(replacer, code)
        
        # 匹配 property: number 模式（如 fontSize: 14）
        num_pattern = re.compile(
            rf'({re.escape(prop)}\s*:\s*)(\d+(\.\d+)?)\b'
        )
        code = num_pattern.sub(r'\g<1>0', code)
    
    # 归一化内联 style 中的颜色值
    code = re.sub(r'#[0-9a-fA-F]{3,8}\b', '"_CSS_"', code)
    
    return code


def _normalize_identifiers(code: str) -> str:
    """变量名/函数名归一化（简化版：用正则替换非保留的标识符）"""
    identifier_map: Dict[str, str] = {}
    counter = [0]
    
    def replace_identifier(match):
        name = match.group(0)
        if name in RESERVED_NAMES:
            return name
        # 跳过全大写的常量名（如 API_URL）
        if name.isupper() and '_' in name:
            return name
        if name not in identifier_map:
            identifier_map[name] = f'_v{counter[0]}_'
            counter[0] += 1
        return identifier_map[name]
    
    # 匹配标识符（但不匹配属性访问的 . 后面的部分和字符串内容）
    # 先保护字符串和模板字面量
    protected: list = []
    
    def protect_strings(m):
        protected.append(m.group(0))
        return f'__STR_PLACEHOLDER_{len(protected) - 1}__'
    
    result = re.sub(
        r'`[^`]*`|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
        protect_strings,
        code
    )
    
    # 替换标识符（不在 . 后面的）
    result = re.sub(r'(?<!\.)(?<![\'"])\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b', replace_identifier, result)
    
    # 恢复字符串
    for i, s in enumerate(protected):
        result = result.replace(f'__STR_PLACEHOLDER_{i}__', s)
    
    return result
