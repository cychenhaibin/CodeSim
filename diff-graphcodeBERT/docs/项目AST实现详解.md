# 项目 AST 实现详解

本文档详细讲解 `diff-graphcodeBERT` 项目中 AST（抽象语法树）的实现细节。

---

## 目录

1. [整体架构](#1-整体架构)
2. [ASTSerializer - AST 序列化器](#2-astserializer---ast-序列化器)
3. [ASTDiffAnalyzer - AST 差异分析器](#3-astdiffanalyzer---ast-差异分析器)
4. [后端 AST 编码](#4-后端-ast-编码)
5. [完整数据流](#5-完整数据流)
6. [核心算法详解](#6-核心算法详解)

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (TypeScript)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐         ┌─────────────────────┐                   │
│  │   ASTSerializer.ts  │         │  ASTDiffAnalyzer.ts │                   │
│  │                     │         │                     │                   │
│  │  代码 → AST → SBT   │         │  代码 → AST → 差异  │                   │
│  │  (向量编码用)       │         │  (结构对比用)       │                   │
│  └──────────┬──────────┘         └──────────┬──────────┘                   │
│             │                               │                              │
│             │ SBT 字符串                    │ DiffResult                   │
│             ▼                               ▼                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        CodeDiffViewer.tsx                           │   │
│  │                        (展示对比结果)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP POST /ast-similarity
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              后端 (Python)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      code_similarity.py                              │   │
│  │                                                                      │   │
│  │   encode_ast_sbt(sbt_string)                                        │   │
│  │       │                                                             │   │
│  │       ▼                                                             │   │
│  │   CodeBERT Tokenizer → Model → 768维向量                            │   │
│  │       │                                                             │   │
│  │       ▼                                                             │   │
│  │   calculate_ast_similarity(sbt1, sbt2) → 余弦相似度                 │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ASTSerializer - AST 序列化器

### 2.1 文件位置

```
frontend/src/utils/ASTSerializer.ts
```

### 2.2 核心功能

将代码转换为 **SBT (Structure-Based Traversal)** 格式的字符串，用于后续的向量编码。

### 2.3 配置选项

```typescript
interface SBTConfig {
  generalizeIdentifiers: boolean;  // 泛化变量名 → _ID_
  generalizeLiterals: boolean;     // 泛化字面量 → _STR_/_NUM_
  ignoreOrder: boolean;            // 忽略子节点顺序（排序）
  maxDepth: number;                // 最大遍历深度
}

// 默认配置
const DEFAULT_CONFIG: SBTConfig = {
  generalizeIdentifiers: true,   // ✅ 变量名不影响相似度
  generalizeLiterals: true,      // ✅ 字面量不影响相似度
  ignoreOrder: true,             // ✅ 顺序不影响相似度
  maxDepth: 50,
};
```

### 2.4 泛化规则

| 原始内容 | 泛化后 | 说明 |
|---------|-------|------|
| `sum`, `add`, `x` | `_ID_` | 所有标识符统一 |
| `"hello"`, `'world'` | `_STR_` | 字符串字面量 |
| `123`, `3.14` | `_NUM_` | 数字字面量 |
| `true`, `false` | `_BOOL_` | 布尔字面量 |
| `null` | `_NULL_` | null 字面量 |
| `<div>`, `<span>` | `_TAG_` | HTML 标签（小写开头） |
| `<Button>`, `<Modal>` | 保留原名 | React 组件（大写开头） |

### 2.5 序列化流程

```typescript
serialize(code: string, language: string): string {
  // 步骤 1: 解析代码为 AST
  const ast = this.parseCode(code, language);
  
  // 步骤 2: AST → NodeInfo（中间结构）
  const nodeInfo = this.astToNodeInfo(ast.program, 0);
  
  // 步骤 3: NodeInfo → SBT 字符串
  return this.nodeInfoToSBT(nodeInfo);
}
```

### 2.6 节点处理示例

#### 标识符处理

```typescript
case 'Identifier':
  // 泛化：sum → _ID_
  info.value = this.config.generalizeIdentifiers 
    ? '_ID_' 
    : (node as t.Identifier).name;
  break;
```

#### 函数处理

```typescript
case 'FunctionDeclaration':
case 'ArrowFunctionExpression':
  const funcNode = node as t.FunctionDeclaration;
  
  // 记录参数数量作为特征
  info.value = `params:${funcNode.params.length}`;
  
  // 递归处理参数
  funcNode.params.forEach(param => {
    info.children.push(this.astToNodeInfo(param, depth + 1));
  });
  
  // 递归处理函数体
  info.children.push(this.astToNodeInfo(funcNode.body, depth + 1));
  break;
```

#### JSX 元素处理

```typescript
case 'JSXOpeningElement':
  const tagName = openingNode.name.name;
  
  // 自定义组件保留名称，HTML 标签泛化
  if (tagName[0] === tagName[0].toUpperCase()) {
    info.value = tagName;  // <Button> → Button
  } else {
    info.value = '_TAG_';  // <div> → _TAG_
  }
  
  // 只保留属性名，不保留属性值
  openingNode.attributes.forEach(attr => {
    info.children.push({
      type: 'JSXAttribute',
      value: attr.name.name,  // onClick, disabled 等
      children: [],
    });
  });
  break;
```

### 2.7 子节点排序（顺序无关）

```typescript
// 如果配置为忽略顺序，对子节点排序
if (this.config.ignoreOrder && info.children.length > 0) {
  info.children.sort((a, b) => {
    const aStr = this.nodeInfoToSBT(a);
    const bStr = this.nodeInfoToSBT(b);
    return aStr.localeCompare(bStr);
  });
}
```

**效果**：
```javascript
// 代码 A
const obj = { b: 2, a: 1 };

// 代码 B
const obj = { a: 1, b: 2 };

// 排序后 SBT 相同 ✓
```

### 2.8 SBT 输出格式

```typescript
private nodeInfoToSBT(info: ASTNodeInfo): string {
  // 格式: ( Type[Value] child1 child2 ... )
  let result = `( ${info.type}`;
  
  if (info.value) {
    result += `[${info.value}]`;
  }
  
  if (info.children.length > 0) {
    const childStrings = info.children.map(child => this.nodeInfoToSBT(child));
    result += ' ' + childStrings.join(' ');
  }
  
  result += ' )';
  return result;
}
```

### 2.9 完整示例

**输入代码**：
```javascript
const add = (a, b) => a + b;
```

**SBT 输出**：
```
( Program 
  ( VariableDeclaration[const] 
    ( VariableDeclarator 
      ( Identifier[_ID_] ) 
      ( ArrowFunctionExpression[params:2] 
        ( Identifier[_ID_] ) 
        ( Identifier[_ID_] ) 
        ( BinaryExpression[+] 
          ( Identifier[_ID_] ) 
          ( Identifier[_ID_] ) 
        ) 
      ) 
    ) 
  ) 
)
```

---

## 3. ASTDiffAnalyzer - AST 差异分析器

### 3.1 文件位置

```
frontend/src/utils/ASTDiffAnalyzer.ts
```

### 3.2 核心功能

通过 AST 结构对比，找出代码的**功能和结构差异**，忽略不影响功能的变化。

### 3.3 关键配置

#### 影响功能的节点类型

```typescript
const STRUCTURAL_NODE_TYPES = new Set([
  // 函数相关
  'FunctionDeclaration',
  'ArrowFunctionExpression',
  'ClassMethod',
  
  // 控制流
  'IfStatement',
  'SwitchStatement',
  'ForStatement',
  'WhileStatement',
  
  // JSX 结构
  'JSXElement',
  'JSXFragment',
  
  // 导入导出
  'ImportDeclaration',
  'ExportDefaultDeclaration',
  
  // 其他...
]);
```

#### 忽略的 JSX 属性（样式相关）

```typescript
const IGNORED_JSX_ATTRIBUTES = new Set([
  'style',
  'className',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'backgroundColor',
  'fontSize',
  // ... 更多样式属性
]);
```

### 3.4 返回结果结构

```typescript
interface DiffResult {
  lineChanges: Change[];              // 行级文本差异
  astChanges: ASTChangeDetail[];      // 语义级差异（导入/函数/类）
  statistics: DiffStatistics;         // 统计信息
  semanticSimilarity: number;         // 语义相似度 0-100
  astStructureSimilarity: number;     // AST 结构相似度 0-100
  astStructureChanges: ASTStructureChange[]; // 节点级差异摘要
  debugInfo?: DebugInfo;              // 调试信息
}
```

### 3.5 分析流程

```typescript
analyzeDiff(oldCode: string, newCode: string): DiffResult {
  // 1. 解析两段代码的 AST
  const oldAST = parse(oldCode, options);
  const newAST = parse(newCode, options);
  
  // 2. 提取结构签名（泛化后的节点表示）
  const oldSignatures = this.extractSignatures(oldAST);
  const newSignatures = this.extractSignatures(newAST);
  
  // 3. 比较签名找出差异
  const changes = this.compareSignatures(oldSignatures, newSignatures);
  
  // 4. 计算相似度
  const similarity = this.calculateSimilarity(oldSignatures, newSignatures);
  
  return { ... };
}
```

---

## 4. 后端 AST 编码

### 4.1 文件位置

```
code_similarity.py
```

### 4.2 核心方法

#### encode_ast_sbt - 将 SBT 编码为向量

```python
def encode_ast_sbt(self, sbt_string: str) -> np.ndarray:
    """
    将 AST 的 SBT 字符串编码为 768 维向量
    
    Args:
        sbt_string: 前端生成的 SBT 格式字符串
        
    Returns:
        numpy array, shape (768,)
    """
    # 1. Tokenize - 将 SBT 字符串转为 token
    inputs = self.tokenizer(
        sbt_string,
        return_tensors='pt',
        max_length=512,
        truncation=True,
        padding='max_length'
    )
    
    # 2. 模型前向传播
    with torch.no_grad():
        outputs = self.model(**inputs)
        last_hidden_state = outputs.last_hidden_state
        
        # 3. 提取 [CLS] token 向量（位置 0）
        cls_vector = last_hidden_state[:, 0, :].squeeze()
        
        # 4. 计算 mean pooling（所有有效 token 的平均）
        attention_mask = inputs['attention_mask']
        mask_expanded = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        sum_embeddings = torch.sum(last_hidden_state * mask_expanded, 1)
        sum_mask = torch.clamp(mask_expanded.sum(1), min=1e-9)
        mean_vector = (sum_embeddings / sum_mask).squeeze()
        
        # 5. 加权组合：70% CLS + 30% Mean
        vector = 0.7 * cls_vector + 0.3 * mean_vector
        
    return vector.numpy()
```

#### calculate_ast_similarity - 计算相似度

```python
def calculate_ast_similarity(self, sbt1: str, sbt2: str) -> float:
    """
    计算两个 AST 的相似度
    
    Args:
        sbt1: 第一个 AST 的 SBT 字符串
        sbt2: 第二个 AST 的 SBT 字符串
        
    Returns:
        相似度 (0.0 ~ 1.0)
    """
    # 1. 编码为向量
    vector1 = self.encode_ast_sbt(sbt1)
    vector2 = self.encode_ast_sbt(sbt2)
    
    # 2. 计算余弦相似度
    similarity = cosine_similarity([vector1], [vector2])[0][0]
    
    # 3. 限制范围
    return float(max(0, min(1, similarity)))
```

### 4.3 为什么用 70% CLS + 30% Mean

| 策略 | 优点 | 缺点 |
|------|------|------|
| 只用 [CLS] | 捕获整体语义 | 可能丢失细节 |
| 只用 Mean | 保留所有信息 | 可能引入噪声 |
| **加权组合** | 平衡整体和细节 | ✅ 推荐 |

---

## 5. 完整数据流

### 5.1 前端调用流程

```typescript
// App.tsx - startCompare 函数

const startCompare = async () => {
  // 1. 前端 AST 差异分析
  const result = analyzer.analyzeDiff(oldCode, newCode);
  setDiffResult(result);

  // 2. 序列化为 SBT
  const sbt1 = serializeToSBT(oldCode, 'javascript');
  const sbt2 = serializeToSBT(newCode, 'javascript');
  
  console.log('SBT1 预览:', sbt1.substring(0, 200));
  console.log('SBT2 预览:', sbt2.substring(0, 200));
  
  // 3. 调用后端 AST 编码 API
  const response = await fetch('/api/ast-similarity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sbt1, sbt2 }),
  });
  
  const data = await response.json();
  // data.similarity: 0.0 ~ 1.0
  // data.similarity_percent: 0 ~ 100
  // data.interpretation: "AST 结构非常相似..."
};
```

### 5.2 后端 API

```python
# api.py

@app.post("/ast-similarity")
async def compare_ast(request: ASTSimilarityRequest):
    """
    比较两个 AST 的结构相似度
    
    请求体:
        sbt1: 第一个 AST 的 SBT 字符串
        sbt2: 第二个 AST 的 SBT 字符串
        
    响应:
        similarity: 相似度 (0-1)
        similarity_percent: 百分比 (0-100)
        interpretation: 解释文本
    """
    det = get_detector()
    similarity = det.calculate_ast_similarity(request.sbt1, request.sbt2)
    
    return ASTSimilarityResponse(
        similarity=similarity,
        similarity_percent=round(similarity * 100, 2),
        interpretation=get_ast_similarity_interpretation(similarity),
    )
```

### 5.3 流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户输入                                        │
│                                                                             │
│   代码 A                                    代码 B                          │
│   const add = (a, b) => a + b;              const sum = (x, y) => x + y;   │
│                                                                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        前端: ASTSerializer                                   │
│                                                                             │
│   1. Babel 解析 → AST                                                       │
│   2. 泛化标识符: a,b,add → _ID_                                             │
│   3. 子节点排序（顺序无关）                                                  │
│   4. 输出 SBT 字符串                                                        │
│                                                                             │
│   SBT1: ( Program ( VariableDeclaration[const] ( ... _ID_ ... ) ) )        │
│   SBT2: ( Program ( VariableDeclaration[const] ( ... _ID_ ... ) ) )        │
│                                                                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                │ HTTP POST { sbt1, sbt2 }
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        后端: CodeBERT 编码                                   │
│                                                                             │
│   1. Tokenizer 处理 SBT 字符串                                              │
│   2. CodeBERT 模型前向传播                                                  │
│   3. 提取向量: 0.7 * [CLS] + 0.3 * Mean                                    │
│                                                                             │
│   Vector1: [0.12, -0.34, 0.56, ..., 0.78]  (768维)                         │
│   Vector2: [0.11, -0.35, 0.55, ..., 0.79]  (768维)                         │
│                                                                             │
│   4. 余弦相似度: cos(V1, V2) = 0.9847                                       │
│                                                                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                                │ { similarity: 0.9847, ... }
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        前端: 展示结果                                        │
│                                                                             │
│   🎯 AST 向量相似度: 98.47%                                                 │
│   (AST 结构几乎完全相同，代码结构高度一致)                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 核心算法详解

### 6.1 SBT 序列化算法

```
输入: AST 根节点
输出: SBT 字符串

算法:
1. 创建节点信息 info = { type, value, children }
2. 根据节点类型处理:
   - Identifier → value = "_ID_" (泛化)
   - StringLiteral → value = "_STR_" (泛化)
   - FunctionDeclaration → value = "params:N"
   - CallExpression → value = "args:N"
   - ...
3. 递归处理所有子节点
4. 如果 ignoreOrder=true，对 children 排序
5. 转换为 SBT 字符串: "( Type[Value] child1 child2 ... )"
```

### 6.2 向量编码算法

```
输入: SBT 字符串
输出: 768 维向量

算法:
1. Tokenize:
   "( Program ... )" → [101, 1006, 7608, ..., 102, 0, 0, ...]
                       [CLS] tokens...      [SEP] padding...

2. 模型前向传播:
   hidden_states = model(input_ids, attention_mask)
   # shape: (1, 512, 768)

3. 提取表示:
   cls = hidden_states[:, 0, :]      # [CLS] 位置
   mean = mean_pooling(hidden_states) # 所有有效 token 平均

4. 加权组合:
   vector = 0.7 * cls + 0.3 * mean
```

### 6.3 余弦相似度算法

```
输入: 向量 A, 向量 B (均为 768 维)
输出: 相似度 (0 ~ 1)

公式:
similarity = (A · B) / (||A|| * ||B||)

其中:
- A · B = Σ(Ai * Bi) 点积
- ||A|| = √Σ(Ai²)  范数
```

### 6.4 为什么这个方案有效

| 问题 | 解决方案 |
|------|---------|
| 变量名不同 | 泛化为 `_ID_` |
| 字面量不同 | 泛化为 `_STR_`/`_NUM_` |
| 顺序不同 | 子节点排序后比较 |
| 格式不同 | AST 天然忽略格式 |
| 语义理解 | CodeBERT 向量编码 |

---

## 总结

### 项目 AST 实现的三个层次

| 层次 | 文件 | 功能 |
|------|------|------|
| **序列化层** | `ASTSerializer.ts` | 代码 → AST → SBT 字符串 |
| **分析层** | `ASTDiffAnalyzer.ts` | 结构差异检测、签名对比 |
| **编码层** | `code_similarity.py` | SBT → 向量 → 相似度 |

### 核心设计思想

1. **泛化**：忽略不影响功能的差异（变量名、字面量）
2. **结构化**：基于 AST 树结构，而非文本
3. **顺序无关**：子节点排序后比较
4. **向量编码**：利用深度学习模型理解代码语义
