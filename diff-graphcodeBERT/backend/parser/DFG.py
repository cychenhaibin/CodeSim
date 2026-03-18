"""
各语言的数据流图 (DFG) 提取函数

移植自 GraphCodeBERT 官方实现:
https://github.com/microsoft/CodeBERT/blob/master/GraphCodeBERT/clonedetection/parser/DFG.py

支持语言：Python, Java, C/C++, JavaScript, Go, Ruby
"""

from typing import List, Tuple, Dict

from .utils import tree_to_variable_index


# 通用辅助函数
def _merge_states(*state_dicts):
    """合并多个 states 字典"""
    new_states = {}
    for dic in state_dicts:
        for key in dic:
            if key not in new_states:
                new_states[key] = dic[key].copy()
            else:
                new_states[key] += dic[key]
    for key in new_states:
        new_states[key] = sorted(list(set(new_states[key])))
    return new_states


def _dedup_dfg(dfg):
    """对 DFG 边去重"""
    dic = {}
    for x in dfg:
        key = (x[0], x[1], x[2])
        if key not in dic:
            dic[key] = [x[3], x[4]]
        else:
            dic[key][0] = list(set(dic[key][0] + x[3]))
            dic[key][1] = sorted(list(set(dic[key][1] + x[4])))
    return [(k[0], k[1], k[2], v[0], v[1]) for k, v in sorted(dic.items(), key=lambda t: t[0][1])]


def _handle_leaf(root_node, index_to_code, states):
    """处理叶子节点（所有语言共用）"""
    if (len(root_node.children) == 0 or root_node.type == 'string') and root_node.type != 'comment':
        key = (root_node.start_point, root_node.end_point)
        if key not in index_to_code:
            return None, states
        idx, code = index_to_code[key]
        if root_node.type == code:
            return ([], states)
        elif code in states:
            return ([(code, idx, 'comesFrom', [code], states[code].copy())], states)
        else:
            if root_node.type == 'identifier':
                states[code] = [idx]
            return ([(code, idx, 'comesFrom', [], [])], states)
    return None, states


def _handle_def(root_node, index_to_code, states, recurse_fn):
    """处理变量定义节点（name = value 模式）"""
    name = root_node.child_by_field_name('name')
    value = root_node.child_by_field_name('value')
    DFG = []
    if value is None:
        if name is not None:
            indexs = tree_to_variable_index(name, index_to_code)
            for index in indexs:
                if index in index_to_code:
                    idx, code = index_to_code[index]
                    DFG.append((code, idx, 'comesFrom', [], []))
                    states[code] = [idx]
        return sorted(DFG, key=lambda x: x[1]), states
    name_indexs = tree_to_variable_index(name, index_to_code)
    value_indexs = tree_to_variable_index(value, index_to_code)
    temp, states = recurse_fn(value, index_to_code, states)
    DFG += temp
    for index1 in name_indexs:
        if index1 not in index_to_code:
            continue
        idx1, code1 = index_to_code[index1]
        for index2 in value_indexs:
            if index2 not in index_to_code:
                continue
            idx2, code2 = index_to_code[index2]
            DFG.append((code1, idx1, 'comesFrom', [code2], [idx2]))
        states[code1] = [idx1]
    return sorted(DFG, key=lambda x: x[1]), states


def _handle_assignment(root_node, index_to_code, states, recurse_fn):
    """处理赋值表达式（left = right）"""
    left_nodes = root_node.child_by_field_name('left')
    right_nodes = root_node.child_by_field_name('right')
    if left_nodes is None or right_nodes is None:
        return [], states
    DFG = []
    temp, states = recurse_fn(right_nodes, index_to_code, states)
    DFG += temp
    name_indexs = tree_to_variable_index(left_nodes, index_to_code)
    value_indexs = tree_to_variable_index(right_nodes, index_to_code)
    for index1 in name_indexs:
        if index1 not in index_to_code:
            continue
        idx1, code1 = index_to_code[index1]
        for index2 in value_indexs:
            if index2 not in index_to_code:
                continue
            idx2, code2 = index_to_code[index2]
            DFG.append((code1, idx1, 'computedFrom', [code2], [idx2]))
        states[code1] = [idx1]
    return sorted(DFG, key=lambda x: x[1]), states


def _handle_increment(root_node, index_to_code, states):
    """处理自增/自减表达式"""
    DFG = []
    indexs = tree_to_variable_index(root_node, index_to_code)
    for index1 in indexs:
        if index1 not in index_to_code:
            continue
        idx1, code1 = index_to_code[index1]
        for index2 in indexs:
            if index2 not in index_to_code:
                continue
            idx2, code2 = index_to_code[index2]
            DFG.append((code1, idx1, 'computedFrom', [code2], [idx2]))
        states[code1] = [idx1]
    return sorted(DFG, key=lambda x: x[1]), states


def _handle_if(root_node, index_to_code, states, recurse_fn, if_types):
    """处理 if 语句（含 else 分支状态合并）"""
    DFG = []
    current_states = states.copy()
    others_states = []
    tag = False
    if 'else' in root_node.type:
        tag = True
    for child in root_node.children:
        if 'else' in child.type:
            tag = True
        if child.type not in if_types:
            temp, current_states = recurse_fn(child, index_to_code, current_states)
            DFG += temp
        else:
            temp, new_states = recurse_fn(child, index_to_code, states)
            DFG += temp
            others_states.append(new_states)
    others_states.append(current_states)
    if not tag:
        others_states.append(states)
    new_states = _merge_states(*others_states)
    return sorted(DFG, key=lambda x: x[1]), new_states


def _handle_while(root_node, index_to_code, states, recurse_fn):
    """处理 while 循环（迭代两次模拟循环语义）"""
    DFG = []
    for _ in range(2):
        for child in root_node.children:
            temp, states = recurse_fn(child, index_to_code, states)
            DFG += temp
    return _dedup_dfg(DFG), states


def _handle_children(root_node, index_to_code, states, recurse_fn, do_first=None):
    """默认递归处理所有子节点"""
    DFG = []
    do_first = do_first or []
    for child in root_node.children:
        if child.type in do_first:
            temp, states = recurse_fn(child, index_to_code, states)
            DFG += temp
    for child in root_node.children:
        if child.type not in do_first:
            temp, states = recurse_fn(child, index_to_code, states)
            DFG += temp
    return sorted(DFG, key=lambda x: x[1]), states


# Python

def DFG_python(root_node, index_to_code, states):
    assignment = ['assignment', 'augmented_assignment', 'for_in_clause']
    if_statement = ['if_statement']
    for_statement = ['for_statement']
    while_statement = ['while_statement']
    do_first = ['for_in_clause']
    def_statement = ['default_parameter']
    states = states.copy()

    leaf_result, states = _handle_leaf(root_node, index_to_code, states)
    if leaf_result is not None:
        return leaf_result, states

    if root_node.type in def_statement:
        return _handle_def(root_node, index_to_code, states, DFG_python)
    elif root_node.type in assignment:
        if root_node.type == 'for_in_clause':
            right_nodes = [root_node.children[-1]]
            left_nodes = [root_node.child_by_field_name('left')]
        else:
            if root_node.child_by_field_name('right') is None:
                return [], states
            left_node = root_node.child_by_field_name('left')
            right_node = root_node.child_by_field_name('right')
            left_nodes = [x for x in left_node.children if x.type != ','] if left_node.children else [left_node]
            right_nodes = [x for x in right_node.children if x.type != ','] if right_node.children else [right_node]
            if len(right_nodes) != len(left_nodes):
                left_nodes = [left_node]
                right_nodes = [right_node]

        DFG = []
        for node in right_nodes:
            temp, states = DFG_python(node, index_to_code, states)
            DFG += temp
        for left_n, right_n in zip(left_nodes, right_nodes):
            left_indexs = tree_to_variable_index(left_n, index_to_code)
            right_indexs = tree_to_variable_index(right_n, index_to_code)
            for idx1_key in left_indexs:
                if idx1_key not in index_to_code:
                    continue
                idx1, code1 = index_to_code[idx1_key]
                DFG.append((code1, idx1, 'computedFrom',
                            [index_to_code[x][1] for x in right_indexs if x in index_to_code],
                            [index_to_code[x][0] for x in right_indexs if x in index_to_code]))
                states[code1] = [idx1]
        return sorted(DFG, key=lambda x: x[1]), states
    elif root_node.type in if_statement:
        return _handle_if(root_node, index_to_code, states, DFG_python, ['elif_clause', 'else_clause'])
    elif root_node.type in for_statement:
        DFG = []
        for _ in range(2):
            right_node = root_node.child_by_field_name('right')
            left_node = root_node.child_by_field_name('left')
            if right_node is None or left_node is None:
                break
            right_nodes = [x for x in right_node.children if x.type != ','] if right_node.children else [right_node]
            left_nodes = [x for x in left_node.children if x.type != ','] if left_node.children else [left_node]
            if len(right_nodes) != len(left_nodes):
                left_nodes = [left_node]
                right_nodes = [right_node]
            for node in right_nodes:
                temp, states = DFG_python(node, index_to_code, states)
                DFG += temp
            for left_n, right_n in zip(left_nodes, right_nodes):
                left_indexs = tree_to_variable_index(left_n, index_to_code)
                right_indexs = tree_to_variable_index(right_n, index_to_code)
                for idx1_key in left_indexs:
                    if idx1_key not in index_to_code:
                        continue
                    idx1, code1 = index_to_code[idx1_key]
                    DFG.append((code1, idx1, 'computedFrom',
                                [index_to_code[x][1] for x in right_indexs if x in index_to_code],
                                [index_to_code[x][0] for x in right_indexs if x in index_to_code]))
                    states[code1] = [idx1]
            if root_node.children and root_node.children[-1].type == 'block':
                temp, states = DFG_python(root_node.children[-1], index_to_code, states)
                DFG += temp
        return _dedup_dfg(DFG), states
    elif root_node.type in while_statement:
        return _handle_while(root_node, index_to_code, states, DFG_python)
    else:
        return _handle_children(root_node, index_to_code, states, DFG_python, do_first)


# Java / C# / C / JavaScript

def _DFG_java_like(root_node, index_to_code, states, recurse_fn):
    assignment = ['assignment_expression']
    def_statement = ['variable_declarator']
    increment_statement = ['update_expression', 'postfix_unary_expression']
    if_statement = ['if_statement', 'else']
    for_statement = ['for_statement']
    enhanced_for_statement = ['enhanced_for_statement', 'for_each_statement', 'for_in_statement']
    while_statement = ['while_statement']
    states = states.copy()

    leaf_result, states = _handle_leaf(root_node, index_to_code, states)
    if leaf_result is not None:
        return leaf_result, states

    if root_node.type in def_statement:
        return _handle_def(root_node, index_to_code, states, recurse_fn)
    elif root_node.type in assignment:
        return _handle_assignment(root_node, index_to_code, states, recurse_fn)
    elif root_node.type in increment_statement:
        return _handle_increment(root_node, index_to_code, states)
    elif root_node.type in if_statement:
        DFG = []
        current_states = states.copy()
        others_states = []
        flag = False
        tag = 'else' in root_node.type
        for child in root_node.children:
            if 'else' in child.type:
                tag = True
            if child.type not in if_statement and not flag:
                temp, current_states = recurse_fn(child, index_to_code, current_states)
                DFG += temp
            else:
                flag = True
                temp, new_states = recurse_fn(child, index_to_code, states)
                DFG += temp
                others_states.append(new_states)
        others_states.append(current_states)
        if not tag:
            others_states.append(states)
        new_states = _merge_states(*others_states)
        return sorted(DFG, key=lambda x: x[1]), new_states
    elif root_node.type in for_statement:
        DFG = []
        for child in root_node.children:
            temp, states = recurse_fn(child, index_to_code, states)
            DFG += temp
        flag = False
        for child in root_node.children:
            if flag:
                temp, states = recurse_fn(child, index_to_code, states)
                DFG += temp
            elif child.type in ('local_variable_declaration', 'declaration'):
                flag = True
        return _dedup_dfg(DFG), states
    elif root_node.type in enhanced_for_statement:
        name = root_node.child_by_field_name('name') or root_node.child_by_field_name('left')
        value = root_node.child_by_field_name('value') or root_node.child_by_field_name('right')
        body = root_node.child_by_field_name('body')
        DFG = []
        if name and value:
            for _ in range(2):
                temp, states = recurse_fn(value, index_to_code, states)
                DFG += temp
                name_indexs = tree_to_variable_index(name, index_to_code)
                value_indexs = tree_to_variable_index(value, index_to_code)
                for index1 in name_indexs:
                    if index1 not in index_to_code:
                        continue
                    idx1, code1 = index_to_code[index1]
                    for index2 in value_indexs:
                        if index2 not in index_to_code:
                            continue
                        idx2, code2 = index_to_code[index2]
                        DFG.append((code1, idx1, 'computedFrom', [code2], [idx2]))
                    states[code1] = [idx1]
                if body:
                    temp, states = recurse_fn(body, index_to_code, states)
                    DFG += temp
        return _dedup_dfg(DFG), states
    elif root_node.type in while_statement:
        return _handle_while(root_node, index_to_code, states, recurse_fn)
    else:
        return _handle_children(root_node, index_to_code, states, recurse_fn)


def DFG_java(root_node, index_to_code, states):
    return _DFG_java_like(root_node, index_to_code, states, DFG_java)

def DFG_c(root_node, index_to_code, states):
    return _DFG_java_like(root_node, index_to_code, states, DFG_c)

def DFG_javascript(root_node, index_to_code, states):
    return _DFG_java_like(root_node, index_to_code, states, DFG_javascript)


# ============================================================================
# Go
# ============================================================================

def DFG_go(root_node, index_to_code, states):
    assignment = ['assignment_statement']
    def_statement = ['var_spec', 'short_var_declaration']
    increment_statement = ['inc_statement']
    if_statement = ['if_statement', 'else']
    for_statement = ['for_statement']
    states = states.copy()

    leaf_result, states = _handle_leaf(root_node, index_to_code, states)
    if leaf_result is not None:
        return leaf_result, states

    if root_node.type in def_statement:
        return _handle_def(root_node, index_to_code, states, DFG_go)
    elif root_node.type in assignment:
        return _handle_assignment(root_node, index_to_code, states, DFG_go)
    elif root_node.type in increment_statement:
        return _handle_increment(root_node, index_to_code, states)
    elif root_node.type in if_statement:
        return _handle_if(root_node, index_to_code, states, DFG_go, if_statement)
    elif root_node.type in for_statement:
        DFG = []
        for child in root_node.children:
            temp, states = DFG_go(child, index_to_code, states)
            DFG += temp
        flag = False
        for child in root_node.children:
            if flag:
                temp, states = DFG_go(child, index_to_code, states)
                DFG += temp
            elif child.type == 'for_clause':
                update = child.child_by_field_name('update')
                if update is not None:
                    temp, states = DFG_go(update, index_to_code, states)
                    DFG += temp
                flag = True
        return _dedup_dfg(DFG), states
    else:
        return _handle_children(root_node, index_to_code, states, DFG_go)


# Ruby

def DFG_ruby(root_node, index_to_code, states):
    assignment = ['assignment', 'operator_assignment']
    if_statement = ['if', 'elsif', 'else', 'unless', 'when']
    for_statement = ['for']
    while_statement = ['while_modifier', 'until']
    def_statement = ['keyword_parameter']

    if (len(root_node.children) == 0 or root_node.type == 'string') and root_node.type != 'comment':
        states = states.copy()
        key = (root_node.start_point, root_node.end_point)
        if key not in index_to_code:
            return [], states
        idx, code = index_to_code[key]
        if root_node.type == code:
            return [], states
        elif code in states:
            return [(code, idx, 'comesFrom', [code], states[code].copy())], states
        else:
            if root_node.type == 'identifier':
                states[code] = [idx]
            return [(code, idx, 'comesFrom', [], [])], states

    states = states.copy()

    if root_node.type in def_statement:
        return _handle_def(root_node, index_to_code, states, DFG_ruby)
    elif root_node.type in assignment:
        if root_node.type == 'operator_assignment':
            left_nodes = [root_node.children[0]] if root_node.children else []
            right_nodes = [root_node.children[-1]] if root_node.children else []
        else:
            left_field = root_node.child_by_field_name('left')
            right_field = root_node.child_by_field_name('right')
            if left_field is None or right_field is None:
                return [], states
            left_nodes = [x for x in left_field.children if x.type != ','] or [left_field]
            right_nodes = [x for x in right_field.children if x.type != ','] or [right_field]
            if len(right_nodes) != len(left_nodes):
                left_nodes = [left_field]
                right_nodes = [right_field]

        DFG = []
        for node in right_nodes:
            temp, states = DFG_ruby(node, index_to_code, states)
            DFG += temp
        for left_n, right_n in zip(left_nodes, right_nodes):
            left_indexs = tree_to_variable_index(left_n, index_to_code)
            right_indexs = tree_to_variable_index(right_n, index_to_code)
            for idx1_key in left_indexs:
                if idx1_key not in index_to_code:
                    continue
                idx1, code1 = index_to_code[idx1_key]
                DFG.append((code1, idx1, 'computedFrom',
                            [index_to_code[x][1] for x in right_indexs if x in index_to_code],
                            [index_to_code[x][0] for x in right_indexs if x in index_to_code]))
                states[code1] = [idx1]
        return sorted(DFG, key=lambda x: x[1]), states
    elif root_node.type in if_statement:
        return _handle_if(root_node, index_to_code, states, DFG_ruby, if_statement)
    elif root_node.type in for_statement:
        DFG = []
        for _ in range(2):
            pattern = root_node.child_by_field_name('pattern')
            value = root_node.child_by_field_name('value')
            body = root_node.child_by_field_name('body')
            if pattern and value:
                temp, states = DFG_ruby(value, index_to_code, states)
                DFG += temp
                left_indexs = tree_to_variable_index(pattern, index_to_code)
                right_indexs = tree_to_variable_index(value, index_to_code)
                for idx1_key in left_indexs:
                    if idx1_key not in index_to_code:
                        continue
                    idx1, code1 = index_to_code[idx1_key]
                    DFG.append((code1, idx1, 'computedFrom',
                                [index_to_code[x][1] for x in right_indexs if x in index_to_code],
                                [index_to_code[x][0] for x in right_indexs if x in index_to_code]))
                    states[code1] = [idx1]
            if body:
                temp, states = DFG_ruby(body, index_to_code, states)
                DFG += temp
        return _dedup_dfg(DFG), states
    elif root_node.type in while_statement:
        return _handle_while(root_node, index_to_code, states, DFG_ruby)
    else:
        return _handle_children(root_node, index_to_code, states, DFG_ruby)
