# 数据流分析与 GraphCodeBERT 详解

## 目录

1. [数据流分析基础](#1-数据流分析基础)
2. [数据流图（DFG）详解](#2-数据流图dfg详解)
3. [GraphCodeBERT 架构详解](#3-graphcodebert-架构详解)
4. [预训练任务](#4-预训练任务)
5. [代码实现详解](#5-代码实现详解)
6. [相似度计算原理](#6-相似度计算原理)
7. [局限性与改进方向](#7-局限性与改进方向)

---

## 1. 数据流分析基础

### 1.1 什么是数据流分析

数据流分析（Data Flow Analysis）是编译器和程序分析中的核心技术，用于追踪程序中数据（变量值）如何在语句之间流动。

```
核心问题：变量 x 在某一点的值，可能来自哪些定义（赋值）？
```

### 1.2 基本概念

#### 定义（Definition）
变量被赋值的位置。

```python
x = 10        # x 的定义点 1
y = x + 5     # y 的定义点
x = 20        # x 的定义点 2（覆盖了定义点 1）
```

#### 使用（Use）
变量被读取的位置。

```python
x = 10        # 定义 x
y = x + 5     # 使用 x（读取 x 的值）
z = x * 2     # 使用 x
```

#### 到达定义（Reaching Definition）
某个变量的定义能够"到达"程序的某一点，意味着该定义可能影响该点的变量值。

```python
x = 1         # 定义 D1
if condition:
    x = 2     # 定义 D2
y = x         # 这里 x 可能来自 D1 或 D2（两个定义都能到达）
```

### 1.3 数据流分析的类型

| 分析类型 | 方向 | 用途 |
|---------|------|------|
| **到达定义分析** | 前向 | 追踪变量值的来源 |
| **活跃变量分析** | 后向 | 判断变量是否还会被使用 |
| **可用表达式分析** | 前向 | 公共子表达式消除 |
| **常量传播分析** | 前向 | 编译时计算常量值 |

### 1.4 为什么数据流对代码理解很重要

```python
# 代码片段 1
def func1():
    a = compute_value()
    b = a + 1
    c = b * 2
    return c

# 代码片段 2  
def func2():
    x = compute_value()
    y = x + 1
    z = y * 2
    return z
```

**文本对比**：完全不同（变量名不同）

**AST 对比**：结构相同，但需要匹配变量

**数据流对比**：
- 两个函数的数据流完全相同
- `返回值 ← 依赖 ← 中间变量 ← 依赖 ← 输入值`
- 能够识别语义等价

---

## 2. 数据流图（DFG）详解

### 2.1 DFG 的定义

数据流图（Data Flow Graph）是一种有向图，表示程序中变量之间的依赖关系。

```
G = (V, E)
- V：变量节点集合
- E：依赖边集合，(u, v) 表示 v 的值依赖于 u
```

### 2.2 DFG 构建示例

#### 示例 1：简单赋值

```python
# 源代码
x = 1
y = 2
z = x + y
```

```
DFG 边：
x → z  （z 的计算使用了 x）
y → z  （z 的计算使用了 y）

图示：
x ──┐
    ├──→ z
y ──┘
```

#### 示例 2：链式依赖

```python
# 源代码
a = input()
b = a * 2
c = b + 1
d = c - a
```

```
DFG 边：
a → b  （b 依赖 a）
b → c  （c 依赖 b）
c → d  （d 依赖 c）
a → d  （d 也依赖 a）

图示：
a ──→ b ──→ c ──→ d
│                 ↑
└─────────────────┘
```

#### 示例 3：条件分支

```python
# 源代码
x = 1
if condition:
    y = x + 1
else:
    y = x - 1
z = y * 2
```

```
DFG 边：
x → y      （两个分支的 y 都依赖 x）
y → z      （z 依赖 y）
condition → y  （隐式：y 的值取决于条件）

图示：
x ────────→ y ──→ z
            ↑
condition ──┘
```

### 2.3 DFG 的形式化定义

对于代码中的每个变量 `v`，我们定义：

```
ComesFrom(v) = {u | v 的值直接依赖于 u 的值}
```

**规则**：

1. **赋值语句** `v = expr`：
   - `ComesFrom(v) = FreeVariables(expr)`
   - 即 v 依赖于表达式中所有自由变量

2. **函数参数**：
   - `ComesFrom(param) = ∅`（参数没有来源）

3. **函数调用** `v = func(a, b)`：
   - `ComesFrom(v) = {a, b, func}`（依赖参数和函数本身）

### 2.4 DFG 提取算法

```python
def extract_dfg(ast_node, variable_scope=None):
    """
    从 AST 提取数据流图
    
    返回：[(source_var, target_var, edge_type), ...]
    """
    if variable_scope is None:
        variable_scope = {}
    
    dfg_edges = []
    
    if ast_node.type == 'Assignment':
        # 赋值语句：target = source_expr
        target = ast_node.target.name
        source_vars = extract_variables(ast_node.value)
        
        for src in source_vars:
            if src in variable_scope:
                # 添加边：src → target
                dfg_edges.append((src, target, 'comesFrom'))
        
        # 更新变量作用域
        variable_scope[target] = ast_node
    
    elif ast_node.type == 'BinaryExpression':
        # 二元表达式：递归处理
        left_vars = extract_variables(ast_node.left)
        right_vars = extract_variables(ast_node.right)
        return left_vars + right_vars
    
    elif ast_node.type == 'FunctionCall':
        # 函数调用：依赖所有参数
        arg_vars = []
        for arg in ast_node.arguments:
            arg_vars.extend(extract_variables(arg))
        return arg_vars
    
    # ... 处理其他节点类型
    
    return dfg_edges
```

### 2.5 DFG 的序列化表示

GraphCodeBERT 需要将 DFG 转换为序列形式输入模型：

```python
def dfg_to_sequence(dfg_edges, code_tokens):
    """
    将 DFG 转换为序列表示
    
    输入：
    - dfg_edges: [(src, tgt, type), ...]
    - code_tokens: 代码的 token 序列
    
    输出：
    - dfg_tokens: DFG 变量的 token 序列
    - dfg_positions: 每个变量在代码中的位置
    """
    # 提取所有出现在 DFG 中的变量
    variables = set()
    for src, tgt, _ in dfg_edges:
        variables.add(src)
        variables.add(tgt)
    
    # 找到每个变量在代码中的位置
    dfg_tokens = []
    dfg_positions = []
    
    for var in variables:
        # 找到变量在 token 序列中的位置
        positions = find_token_positions(code_tokens, var)
        dfg_tokens.append(var)
        dfg_positions.append(positions)
    
    return dfg_tokens, dfg_positions
```

---

## 3. GraphCodeBERT 架构详解

### 3.1 背景：从 CodeBERT 到 GraphCodeBERT

| 特性 | CodeBERT | GraphCodeBERT |
|-----|----------|---------------|
| 输入 | 代码 + 自然语言 | 代码 + 自然语言 + DFG |
| 结构信息 | 无 | 数据流图 |
| 预训练任务 | MLM + RTD | MLM + DFG Edge Prediction |

### 3.2 模型输入格式

```
输入序列格式：
[CLS] <code_tokens> [SEP] <dfg_variables> [SEP]

示例：
代码: x = 1; y = x + 2
DFG: x → y

输入: [CLS] x = 1 ; y = x + 2 [SEP] x y [SEP]
位置: 0     1 2 3 4 5 6 7 8 9  10   11 12 13
```

### 3.3 三种 Attention 机制

GraphCodeBERT 使用三种注意力来融合不同信息：

#### 3.3.1 Token-Token Attention（标准 Self-Attention）

```
代码 token 之间的注意力，捕获语法关系

[x] [=] [1] [;] [y] [=] [x] [+] [2]
 ↑   ↑   ↑   ↑   ↑   ↑   ↑   ↑   ↑
 └───┴───┴───┴───┴───┴───┴───┴───┘
         标准 Transformer Attention
```

#### 3.3.2 Token-Node Attention（代码与DFG变量）

```
代码 token 与 DFG 变量节点之间的注意力

代码: [x] [=] [1] [;] [y] [=] [x] [+] [2]
                 ↕           ↕
DFG:           [x]         [y]

让模型学习代码中哪个位置对应哪个变量
```

#### 3.3.3 Node-Node Attention（DFG边信息）

```
DFG 变量节点之间的注意力，由 DFG 边引导

DFG 节点: [x] ──→ [y]

注意力矩阵（带 DFG 边掩码）：
        x    y
    x   1    1 (x→y 存在边)
    y   0    1 (y→x 无边)
```

### 3.4 位置编码设计

GraphCodeBERT 使用特殊的位置编码来表示 DFG：

```python
# 位置编码
position_ids = [
    0,  # [CLS]
    1, 2, 3, 4, 5, 6, 7, 8, 9,  # 代码 tokens
    10,  # [SEP]
    # DFG 变量使用其在代码中首次出现的位置
    1,   # 变量 x 首次出现在位置 1
    5,   # 变量 y 首次出现在位置 5
    11   # [SEP]
]
```

这样设计的好处：
- DFG 变量与其在代码中的位置对齐
- 模型能学习变量的上下文

### 3.5 注意力掩码

```python
def create_attention_mask(code_length, dfg_length, dfg_edges):
    """
    创建 GraphCodeBERT 的注意力掩码
    """
    total_length = code_length + dfg_length + 3  # +3 for [CLS], [SEP], [SEP]
    
    # 初始化：代码部分完全可见
    mask = torch.zeros(total_length, total_length)
    
    # 代码 tokens 之间：完全注意力
    mask[:code_length+2, :code_length+2] = 1
    
    # 代码 → DFG：完全注意力
    mask[:code_length+2, code_length+2:] = 1
    
    # DFG → 代码：完全注意力
    mask[code_length+2:, :code_length+2] = 1
    
    # DFG 节点之间：只有存在边的才有注意力
    for src_idx, tgt_idx in dfg_edges:
        mask[code_length+2+src_idx, code_length+2+tgt_idx] = 1
        # 自注意力
        mask[code_length+2+src_idx, code_length+2+src_idx] = 1
    
    return mask
```

---

## 4. 预训练任务

### 4.1 Masked Language Modeling (MLM)

与 BERT 相同，随机遮盖 token 并预测：

```
原始: x = 1; y = x + 2
遮盖: x = [MASK]; y = x + 2
目标: 预测 [MASK] = "1"
```

### 4.2 Edge Prediction（DFG 边预测）

GraphCodeBERT 的独特预训练任务：

```python
def edge_prediction_task(code, dfg_edges):
    """
    预测 DFG 中是否存在边
    
    正样本：真实的 DFG 边
    负样本：随机采样的非边
    """
    positive_edges = dfg_edges  # 真实边
    
    # 生成负样本
    all_variables = get_all_variables(code)
    negative_edges = []
    for v1 in all_variables:
        for v2 in all_variables:
            if (v1, v2) not in dfg_edges:
                negative_edges.append((v1, v2))
    
    # 随机采样负样本
    negative_edges = random.sample(negative_edges, len(positive_edges))
    
    return positive_edges, negative_edges
```

**训练目标**：

```
Loss = -Σ log P(edge exists | v1, v2)  for positive edges
       -Σ log P(no edge | v1, v2)      for negative edges
```

### 4.3 Node Alignment（节点对齐）

预测 DFG 节点对应代码中的哪个位置：

```
代码: [x] [=] [1] [;] [y] [=] [x] [+] [2]
位置:  1   2   3   4   5   6   7   8   9

DFG 节点 "x" → 应该对齐到位置 1 和 7
DFG 节点 "y" → 应该对齐到位置 5
```

---

## 5. 代码实现详解

### 5.1 DFG 提取器实现

本项目中的 DFG 提取（简化版）：

```python
# code_similarity.py 中的实现

def extract_dfg_simple(code: str, lang: str) -> List[Tuple[str, str]]:
    """
    简化版 DFG 提取
    
    基于正则表达式和简单解析，提取变量依赖关系
    """
    edges = []
    
    # 找出所有赋值语句
    # 模式: variable = expression
    assignment_pattern = r'(\w+)\s*=\s*([^=][^;]*)'
    
    for match in re.finditer(assignment_pattern, code):
        target = match.group(1)
        expression = match.group(2)
        
        # 从表达式中提取使用的变量
        used_vars = re.findall(r'\b([a-zA-Z_]\w*)\b', expression)
        
        # 过滤掉关键字和函数名
        used_vars = [v for v in used_vars if v not in KEYWORDS]
        
        # 添加边
        for var in used_vars:
            edges.append((var, target))
    
    return edges
```

### 5.2 完整 DFG 提取（使用 tree-sitter）

```python
# 使用 tree-sitter 的完整实现

from tree_sitter import Language, Parser

def extract_dfg_treesitter(code: str, language: str) -> List[Tuple]:
    """
    使用 tree-sitter 提取 DFG
    """
    parser = Parser()
    parser.set_language(Language('build/languages.so', language))
    
    tree = parser.parse(bytes(code, 'utf-8'))
    root = tree.root_node
    
    dfg = []
    variable_defs = {}  # 变量定义位置
    
    def traverse(node, scope):
        if node.type == 'assignment':
            # 赋值语句
            target = get_identifier(node.child_by_field_name('left'))
            value = node.child_by_field_name('right')
            
            # 提取右侧使用的变量
            used_vars = extract_identifiers(value)
            
            for var in used_vars:
                if var in scope:
                    # 添加数据流边
                    dfg.append((
                        var,                    # 源变量
                        target,                 # 目标变量
                        node.start_point[0],    # 行号
                        'comesFrom'             # 边类型
                    ))
            
            # 更新作用域
            scope[target] = node.start_point
        
        elif node.type == 'function_definition':
            # 新的函数作用域
            new_scope = scope.copy()
            # 添加参数到作用域
            for param in get_parameters(node):
                new_scope[param] = node.start_point
            
            # 遍历函数体
            for child in node.children:
                traverse(child, new_scope)
            return
        
        # 递归遍历子节点
        for child in node.children:
            traverse(child, scope)
    
    traverse(root, {})
    return dfg
```

### 5.3 GraphCodeBERT 编码实现

```python
# code_similarity.py 中的实现

class CodeSimilarityDetector:
    def __init__(self):
        self.tokenizer = RobertaTokenizer.from_pretrained(
            "microsoft/graphcodebert-base"
        )
        self.model = RobertaModel.from_pretrained(
            "microsoft/graphcodebert-base"
        )
    
    def encode_with_dfg(self, code: str, lang: str) -> torch.Tensor:
        """
        将代码编码为向量，包含 DFG 信息
        """
        # 1. 提取 DFG
        dfg_edges = extract_dfg_simple(code, lang)
        
        # 2. 准备输入
        code_tokens = self.tokenizer.tokenize(code)
        
        # 3. 获取 DFG 变量
        dfg_vars = list(set(
            [src for src, _ in dfg_edges] + 
            [tgt for _, tgt in dfg_edges]
        ))
        
        # 4. 构建输入序列
        # [CLS] code_tokens [SEP] dfg_vars [SEP]
        input_tokens = (
            [self.tokenizer.cls_token] + 
            code_tokens + 
            [self.tokenizer.sep_token] + 
            dfg_vars + 
            [self.tokenizer.sep_token]
        )
        
        # 5. 转换为 ID
        input_ids = self.tokenizer.convert_tokens_to_ids(input_tokens)
        
        # 6. 构建位置编码
        position_ids = self._build_position_ids(
            code_tokens, dfg_vars, code
        )
        
        # 7. 构建注意力掩码
        attention_mask = self._build_attention_mask(
            len(code_tokens), len(dfg_vars), dfg_edges
        )
        
        # 8. 前向传播
        with torch.no_grad():
            outputs = self.model(
                input_ids=torch.tensor([input_ids]),
                position_ids=torch.tensor([position_ids]),
                attention_mask=attention_mask
            )
        
        # 9. 返回 [CLS] 向量作为代码表示
        return outputs.last_hidden_state[:, 0, :]
```

### 5.4 简化版实现（不使用完整 DFG）

```python
def get_code_embedding_simple(self, code: str) -> torch.Tensor:
    """
    简化版：只使用代码 token，不构建完整 DFG
    
    原因：
    1. 完整 DFG 提取需要语言特定的解析器
    2. GraphCodeBERT 预训练时已经学习了 DFG 模式
    3. 即使不显式提供 DFG，模型仍能捕获部分数据流信息
    """
    # 清理代码
    cleaned_code = self.preprocess_code(code)
    
    # Tokenize
    inputs = self.tokenizer(
        cleaned_code,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True
    )
    
    # 前向传播
    with torch.no_grad():
        outputs = self.model(**inputs)
    
    # 返回 [CLS] token 的隐藏状态
    return outputs.last_hidden_state[:, 0, :]
```

---

## 6. 相似度计算原理

### 6.1 向量空间模型

代码被编码为高维向量后，相似度计算转化为向量距离问题：

```
代码 A → 向量 vA ∈ R^768
代码 B → 向量 vB ∈ R^768

相似度 = f(vA, vB)
```

### 6.2 余弦相似度

```python
def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    """
    余弦相似度：衡量向量方向的相似性
    
    公式: cos(θ) = (v1 · v2) / (||v1|| × ||v2||)
    
    范围: [-1, 1]
    - 1: 完全相同方向
    - 0: 正交（无关）
    - -1: 完全相反方向
    """
    dot_product = np.dot(v1, v2)
    norm_v1 = np.linalg.norm(v1)
    norm_v2 = np.linalg.norm(v2)
    
    return dot_product / (norm_v1 * norm_v2)
```

### 6.3 为什么余弦相似度适合代码

```
优点：
1. 尺度不变性：只关注方向，不关注大小
2. 计算高效：O(n) 复杂度
3. 符合直觉：相似代码的向量方向接近

示例：
- 完全相同的代码 → cos ≈ 1.0
- 变量重命名 → cos ≈ 0.95-0.99
- 功能相似但实现不同 → cos ≈ 0.7-0.9
- 完全不同的代码 → cos ≈ 0.3-0.5
```

### 6.4 其他相似度度量

```python
def euclidean_distance(v1, v2):
    """欧氏距离"""
    return np.linalg.norm(v1 - v2)

def manhattan_distance(v1, v2):
    """曼哈顿距离"""
    return np.sum(np.abs(v1 - v2))

def jaccard_similarity(v1, v2):
    """Jaccard 相似度（用于集合）"""
    intersection = np.minimum(v1, v2).sum()
    union = np.maximum(v1, v2).sum()
    return intersection / union
```

### 6.5 相似度解释

```python
def interpret_similarity(similarity: float) -> str:
    """
    将相似度数值转换为可理解的解释
    """
    if similarity >= 0.95:
        return "极高相似度：代码几乎相同，可能是直接复制"
    elif similarity >= 0.85:
        return "高相似度：核心功能相同，存在细微差异（如变量名）"
    elif similarity >= 0.70:
        return "较高相似度：相似的算法或模式"
    elif similarity >= 0.50:
        return "中等相似度：部分代码相似"
    elif similarity >= 0.30:
        return "较低相似度：存在少量相似特征"
    else:
        return "低相似度：代码功能不同"
```

---

## 7. 局限性与改进方向

### 7.1 当前方法的局限性

#### 7.1.1 长代码问题

```
问题：Transformer 最大长度 512 tokens
     长函数可能被截断

解决方案：
1. 代码分块处理
2. 使用 Longformer 等长序列模型
3. 只保留关键代码段
```

#### 7.1.2 跨语言问题

```
问题：不同语言的语法差异
     Python 和 Java 的相同功能，表示方式不同

解决方案：
1. 使用多语言预训练模型（如 CodeT5）
2. 中间表示转换
3. 语言无关的抽象语法树
```

#### 7.1.3 语义等价但结构不同

```python
# 以下代码语义等价，但 GraphCodeBERT 可能给出较低相似度

# 版本 1: 迭代
def sum_list_v1(arr):
    result = 0
    for x in arr:
        result += x
    return result

# 版本 2: 函数式
def sum_list_v2(arr):
    return reduce(lambda a, b: a + b, arr, 0)

# 版本 3: 内置函数
def sum_list_v3(arr):
    return sum(arr)
```

### 7.2 改进方向

#### 7.2.1 结合 AST 分析

```
GraphCodeBERT（语义） + AST（结构）= 更准确的相似度

本项目的做法：
1. AST 分析：识别结构相似、变量重命名
2. GraphCodeBERT：提供语义相似度作为补充
3. 综合判断：加权融合两种分析结果
```

#### 7.2.2 Token 级别的对齐

```python
def token_level_similarity(code1, code2):
    """
    不只计算整体相似度，还计算 token 级别的对齐
    
    用于：
    1. 解释哪些部分相似
    2. 生成更精确的 diff
    """
    # 获取所有 token 的向量
    embeddings1 = get_all_token_embeddings(code1)
    embeddings2 = get_all_token_embeddings(code2)
    
    # 计算 token 之间的相似度矩阵
    similarity_matrix = cosine_similarity(embeddings1, embeddings2)
    
    # 使用匈牙利算法找最优对齐
    alignment = find_optimal_alignment(similarity_matrix)
    
    return alignment
```

#### 7.2.3 对比学习

```python
def contrastive_learning_objective(anchor, positive, negative):
    """
    对比学习目标：
    - anchor 和 positive 应该相似（同一代码的变体）
    - anchor 和 negative 应该不同（不同功能的代码）
    
    可以用于微调 GraphCodeBERT 以适应特定任务
    """
    sim_pos = cosine_similarity(anchor, positive)
    sim_neg = cosine_similarity(anchor, negative)
    
    # Triplet Loss
    loss = max(0, margin + sim_neg - sim_pos)
    
    return loss
```

### 7.3 未来研究方向

1. **程序合成**：从自然语言生成代码
2. **代码修复**：自动检测和修复 bug
3. **代码推荐**：智能代码补全
4. **漏洞检测**：识别安全风险代码
5. **代码迁移**：不同语言间的代码转换

---

## 参考文献

1. **GraphCodeBERT**: Guo et al., "GraphCodeBERT: Pre-training Code Representations with Data Flow", ICLR 2021

2. **CodeBERT**: Feng et al., "CodeBERT: A Pre-Trained Model for Programming and Natural Languages", EMNLP 2020

3. **数据流分析**: Aho et al., "Compilers: Principles, Techniques, and Tools" (龙书)

4. **Tree-sitter**: [tree-sitter.github.io](https://tree-sitter.github.io/)

5. **Hugging Face**: [huggingface.co/microsoft/graphcodebert-base](https://huggingface.co/microsoft/graphcodebert-base)

---

*文档版本：1.0*  
*最后更新：2026-02-05*
