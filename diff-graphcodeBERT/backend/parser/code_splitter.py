"""
基于 Tree-sitter 的代码拆分器
使用 CST（具体语法树）精确拆分代码为语义单元，不丢失任何细节
"""

from typing import List, Dict, Any, Optional, Union
from tree_sitter import Node, Parser
from . import _get_parser


class TreeSitterCodeSplitter:
    """
    使用 Tree-sitter 将代码拆分为函数/组件级别的语义单元
    
    优势：
    1. CST 保留所有源代码细节（空格、注释、格式）
    2. 节点边界精确，不会丢失代码
    3. 支持多种语言（JavaScript/TypeScript/Python/Java 等）
    """
    
    def __init__(self, lang: str = 'javascript'):
        self.lang = lang
        self.parser = _get_parser(lang)
    
    def split_code(self, code: str, max_chars: int = 500) -> List[Dict[str, Any]]:
        """
        将代码拆分为语义单元
        
        Args:
            code: 源代码字符串
            max_chars: 单个单元的最大字符数（用于触发二次拆分）
        
        Returns:
            单元列表，每个单元包含：
            - name: 单元名称
            - type: 单元类型（function/component/hook/class/imports/variable/other）
            - code: 代码片段
            - startLine: 起始行号（1-based）
            - endLine: 结束行号（1-based）
            - lineCount: 行数
        """
        if not self.parser:
            return [{
                'name': 'whole_file',
                'type': 'other',
                'code': code,
                'startLine': 1,
                'endLine': len(code.split('\n')),
                'lineCount': len(code.split('\n'))
            }]
        
        tree = self.parser.parse(bytes(code, 'utf-8'))
        root = tree.root_node
        
        code_bytes = bytes(code, 'utf-8')
        lines = code.split('\n')
        
        units = []
        
        # 处理 JavaScript/TypeScript
        if self.lang in ['javascript', 'typescript', 'tsx']:
            units = self._split_javascript(root, code_bytes, lines, max_chars)
        # 处理 Python
        elif self.lang == 'python':
            units = self._split_python(root, code_bytes, lines, max_chars)
        
        # 按行号排序
        units.sort(key=lambda u: u['startLine'])
        
        return units if units else [{
            'name': 'whole_file',
            'type': 'other',
            'code': code,
            'startLine': 1,
            'endLine': len(lines),
            'lineCount': len(lines)
        }]
    
    def _split_javascript(
        self,
        root: Node,
        code_bytes: bytes,
        lines: List[str],
        max_chars: int
    ) -> List[Dict[str, Any]]:
        """拆分 JavaScript/TypeScript 代码"""
        units = []
        imports = []
        
        # 遍历顶层节点
        for child in root.children:
            # 收集所有 import
            if child.type == 'import_statement':
                imports.append(child)
                continue
            
            unit = self._extract_js_node(child, code_bytes, lines, max_chars)
            if unit:
                # 如果返回的是多个子单元（拆分结果）
                if isinstance(unit, list):
                    units.extend(unit)
                else:
                    units.append(unit)
        
        # 合并所有 import 为一个单元
        if imports:
            first_import = imports[0]
            last_import = imports[-1]
            import_unit = self._node_to_unit(
                first_import, 'imports', 'imports', code_bytes, lines,
                end_node=last_import
            )
            units.insert(0, import_unit)
        
        # 对超限单元进行二次拆分
        final_units = []
        for unit in units:
            if len(unit['code']) > max_chars and unit['type'] != 'imports':
                # 需要二次拆分：重新解析这个单元的代码
                sub_tree = self.parser.parse(bytes(unit['code'], 'utf-8'))
                sub_root = sub_tree.root_node
                
                # 找到对应的函数/组件节点
                for child in sub_root.children:
                    if child.type in ['lexical_declaration', 'variable_declaration', 'function_declaration']:
                        sub_units = self._split_large_node(
                            child, unit['name'], unit['type'], 
                            bytes(unit['code'], 'utf-8'), unit['code'].split('\n'), max_chars
                        )
                        if sub_units:
                            # 修正子单元的行号（相对于原始文件）
                            for sub in sub_units:
                                sub['startLine'] += unit['startLine'] - 1
                                sub['endLine'] += unit['startLine'] - 1
                            final_units.extend(sub_units)
                        else:
                            final_units.append(unit)
                        break
                else:
                    final_units.append(unit)
            else:
                final_units.append(unit)
        
        return final_units
    
    def _extract_js_node(
        self,
        node: Node,
        code_bytes: bytes,
        lines: List[str],
        max_chars: int,
        parent_name: str = ''
    ) -> Union[Dict[str, Any], List[Dict[str, Any]], None]:
        """提取 JavaScript 节点为单元（可能返回单个单元或多个子单元）"""
        node_type = node.type
        
        # 函数声明：function foo() {}
        if node_type == 'function_declaration':
            name_node = node.child_by_field_name('name')
            name = self._get_node_text(name_node, code_bytes) if name_node else 'anonymous'
            unit_type = self._infer_js_type(name)
            unit = self._node_to_unit(node, name, unit_type, code_bytes, lines)
            
            # 如果函数太大，尝试拆分内部
            if unit and len(unit['code']) > max_chars:
                sub_units = self._split_large_node(node, name, unit_type, code_bytes, lines, max_chars)
                return sub_units if sub_units else [unit]
            return unit
        
        # 变量声明：const foo = ..., let bar = ...
        elif node_type == 'lexical_declaration' or node_type == 'variable_declaration':
            declarator = None
            for child in node.children:
                if child.type == 'variable_declarator':
                    declarator = child
                    break
            
            if declarator:
                name_node = declarator.child_by_field_name('name')
                if name_node:
                    name = self._get_node_text(name_node, code_bytes)
                    
                    # 判断是否是数组解构（useState）
                    if name_node.type == 'array_pattern':
                        first_elem = name_node.children[1] if len(name_node.children) > 1 else None
                        if first_elem and first_elem.type == 'identifier':
                            name = self._get_node_text(first_elem, code_bytes)
                    
                    unit_type = self._infer_js_type(name)
                    unit = self._node_to_unit(node, name, unit_type, code_bytes, lines)
                    
                    # 检查是否超限（大变量如 fields 数组）
                    if unit and len(unit['code']) > max_chars:
                        # 大变量无法再拆分，但要完整保留
                        # 不触发 _split_large_node，因为变量声明不能拆分
                        pass
                    
                    return unit
        
        # 类声明
        elif node_type == 'class_declaration':
            name_node = node.child_by_field_name('name')
            name = self._get_node_text(name_node, code_bytes) if name_node else 'AnonymousClass'
            return self._node_to_unit(node, name, 'class', code_bytes, lines)
        
        # Export 声明
        elif node_type == 'export_statement':
            for child in node.children:
                if child.type in ['function_declaration', 'class_declaration', 'lexical_declaration', 'variable_declaration']:
                    return self._extract_js_node(child, code_bytes, lines, max_chars, parent_name)
        
        return None
    
    def _split_large_node(
        self,
        node: Node,
        name: str,
        unit_type: str,
        code_bytes: bytes,
        lines: List[str],
        max_chars: int
    ) -> List[Dict[str, Any]]:
        """
        拆分超大节点（如包含大 return 语句的函数/组件）
        策略：提取内部的子函数、变量声明、return 语句、JSX 元素等
        """
        sub_units = []
        
        # 找到函数体（statement_block）
        function_body = None
        
        # 如果是 lexical_declaration (const Foo = () => {})
        if node.type in ['lexical_declaration', 'variable_declaration']:
            for child in node.children:
                if child.type == 'variable_declarator':
                    value_node = child.child_by_field_name('value')
                    if value_node and value_node.type == 'arrow_function':
                        function_body = value_node.child_by_field_name('body')
                        break
        
        # 如果是 function_declaration
        elif node.type == 'function_declaration':
            function_body = node.child_by_field_name('body')
        
        if not function_body or function_body.type != 'statement_block':
            return []
        
        # 遍历函数体内的语句
        for child in function_body.children:
            # 内部函数声明
            if child.type == 'function_declaration':
                sub = self._node_to_unit(child, self._get_function_name(child, code_bytes), 'function', code_bytes, lines)
                if sub:
                    sub['name'] = f"{name}/{sub['name']}"
                    # 即使超限也保留，因为是完整的语义单元
                    sub_units.append(sub)
            
            # 内部变量声明（hooks, handlers）
            elif child.type in ['lexical_declaration', 'variable_declaration']:
                sub = self._extract_variable_unit(child, code_bytes, lines)
                if sub:
                    sub['name'] = f"{name}/{sub['name']}"
                    # 即使超限也保留（如大的 fields 数组），因为变量声明不能再拆分
                    sub_units.append(sub)
            
            # return 语句
            elif child.type == 'return_statement':
                sub = self._node_to_unit(child, 'return_block', 'other', code_bytes, lines)
                if sub and len(sub['code']) <= max_chars:
                    sub['name'] = f"{name}/return_block"
                    sub_units.append(sub)
                elif sub:
                    # return 语句太大，提取内部 JSX
                    jsx_units = self._extract_jsx_from_node(child, code_bytes, lines, max_chars)
                    for jsx_unit in jsx_units:
                        jsx_unit['name'] = f"{name}/{jsx_unit['name']}"
                    sub_units.extend(jsx_units)
        
        return sub_units
    
    def _get_function_name(self, node: Node, code_bytes: bytes) -> str:
        """获取函数名称"""
        name_node = node.child_by_field_name('name')
        return self._get_node_text(name_node, code_bytes) if name_node else 'anonymous'
    
    def _extract_variable_unit(self, node: Node, code_bytes: bytes, lines: List[str]) -> Optional[Dict[str, Any]]:
        """提取变量声明单元"""
        declarator = None
        for child in node.children:
            if child.type == 'variable_declarator':
                declarator = child
                break
        
        if not declarator:
            return None
        
        name_node = declarator.child_by_field_name('name')
        if not name_node:
            return None
        
        name = self._get_node_text(name_node, code_bytes)
        
        # 处理数组解构：const [visible, setVisible] = useState()
        if name_node.type == 'array_pattern':
            first_elem = name_node.children[1] if len(name_node.children) > 1 else None
            if first_elem and first_elem.type == 'identifier':
                name = self._get_node_text(first_elem, code_bytes)
        
        unit_type = self._infer_js_type(name)
        return self._node_to_unit(node, name, unit_type, code_bytes, lines)
    
    def _extract_jsx_from_node(
        self,
        node: Node,
        code_bytes: bytes,
        lines: List[str],
        max_chars: int,
        depth: int = 0
    ) -> List[Dict[str, Any]]:
        """
        从节点中递归提取 JSX 元素
        策略：提取所有 JSX 元素（包括超限的），如果超限则额外提取其子元素
        """
        if depth > 10:
            return []
        
        jsx_units = []
        
        def find_jsx(n: Node, current_depth: int):
            if current_depth > 10:
                return
            
            # JSX 元素
            if n.type == 'jsx_element':
                jsx_name = self._get_jsx_name(n, code_bytes)
                unit = self._node_to_unit(n, jsx_name, 'other', code_bytes, lines)
                
                if unit:
                    # 总是添加这个 JSX 元素（即使超限）
                    jsx_units.append(unit)
                    
                    # 如果太大，额外提取其子元素（作为更细粒度的单元）
                    if len(unit['code']) > max_chars:
                        for child in n.children:
                            find_jsx(child, current_depth + 1)
            
            # 自闭合 JSX 元素
            elif n.type == 'jsx_self_closing_element':
                jsx_name = self._get_jsx_name(n, code_bytes)
                unit = self._node_to_unit(n, jsx_name, 'other', code_bytes, lines)
                if unit:
                    jsx_units.append(unit)
            
            # 继续遍历子节点（非 JSX 节点）
            else:
                for child in n.children:
                    find_jsx(child, current_depth + 1)
        
        find_jsx(node, depth)
        return jsx_units
    
    def _get_jsx_name(self, node: Node, code_bytes: bytes) -> str:
        """获取 JSX 元素的名称"""
        for child in node.children:
            if child.type in ['jsx_opening_element', 'jsx_self_closing_element']:
                name_node = child.child_by_field_name('name')
                if name_node:
                    return self._get_node_text(name_node, code_bytes)
        return 'jsx_element'
    
    def _split_python(
        self,
        root: Node,
        code_bytes: bytes,
        lines: List[str],
        max_chars: int
    ) -> List[Dict[str, Any]]:
        """拆分 Python 代码"""
        units = []
        
        for child in root.children:
            # 函数定义
            if child.type == 'function_definition':
                name_node = child.child_by_field_name('name')
                name = self._get_node_text(name_node, code_bytes) if name_node else 'anonymous'
                units.append(self._node_to_unit(child, name, 'function', code_bytes, lines))
            
            # 类定义
            elif child.type == 'class_definition':
                name_node = child.child_by_field_name('name')
                name = self._get_node_text(name_node, code_bytes) if name_node else 'AnonymousClass'
                units.append(self._node_to_unit(child, name, 'class', code_bytes, lines))
            
            # import 语句
            elif child.type in ['import_statement', 'import_from_statement']:
                units.append(self._node_to_unit(child, 'imports', 'imports', code_bytes, lines))
        
        return units
    
    def _node_to_unit(
        self,
        node: Node,
        name: str,
        unit_type: str,
        code_bytes: bytes,
        lines: List[str],
        end_node: Optional[Node] = None
    ) -> Dict[str, Any]:
        """
        将 Tree-sitter 节点转换为代码单元
        
        Args:
            end_node: 可选的结束节点（用于合并多个 import）
        """
        start_line = node.start_point[0] + 1
        end_line = (end_node.end_point[0] + 1) if end_node else (node.end_point[0] + 1)
        
        # 使用节点的字节范围提取代码（保证完整性）
        start_byte = node.start_byte
        end_byte = end_node.end_byte if end_node else node.end_byte
        code = code_bytes[start_byte:end_byte].decode('utf-8')
        
        return {
            'name': name,
            'type': unit_type,
            'code': code,
            'startLine': start_line,
            'endLine': end_line,
            'lineCount': end_line - start_line + 1
        }
    
    def _get_node_text(self, node: Node, code_bytes: bytes) -> str:
        """获取节点的文本内容"""
        if node is None:
            return ''
        return code_bytes[node.start_byte:node.end_byte].decode('utf-8')
    
    def _infer_js_type(self, name: str) -> str:
        """推断 JavaScript 标识符的类型"""
        # React 组件：首字母大写
        if name and name[0].isupper():
            return 'component'
        # React Hooks：use 开头
        if name.startswith('use') and len(name) > 3 and name[3].isupper():
            return 'hook'
        # 事件处理器
        if name.startswith('handle') or name.startswith('on'):
            return 'function'
        return 'variable'
