# AST（抽象语法树）详解

## 目录

1. [什么是 AST](#1-什么是-ast)
2. [AST 的核心概念](#2-ast-的核心概念)
3. [AST 节点类型详解](#3-ast-节点类型详解)
4. [AST 的生成过程](#4-ast-的生成过程)
5. [AST 在代码分析中的应用](#5-ast-在代码分析中的应用)
6. [AST 与代码相似度检测](#6-ast-与代码相似度检测)
7. [实战：AST 序列化与向量编码](#7-实战ast-序列化与向量编码)
8. [常用 AST 工具](#8-常用-ast-工具)

---

## 1. 什么是 AST

### 1.1 定义

**AST（Abstract Syntax Tree，抽象语法树）** 是源代码的树状结构表示。它抽象掉了代码的具体语法细节（如括号、分号、空格），只保留程序的**语义结构**。

### 1.2 为什么需要 AST

```
源代码（文本）
    │
    │  人类可读，但计算机难以理解语义
    │
    ▼
   AST（树结构）
    │
    │  结构化表示，便于分析和处理
    │
    ▼
执行/编译/分析
```

### 1.3 简单示例

```javascript
// 源代码
const sum = a + b;
```

对应的 AST（简化）：

```
Program
└── VariableDeclaration (kind: "const")
    └── VariableDeclarator
        ├── Identifier (name: "sum")      // 变量名
        └── BinaryExpression (operator: "+")  // 加法表达式
            ├── Identifier (name: "a")    // 左操作数
            └── Identifier (name: "b")    // 右操作数
```

### 1.4 AST 的特点

| 特点 | 说明 |
|------|------|
| **抽象性** | 忽略空格、注释、括号等不影响语义的元素 |
| **结构性** | 树形结构，有明确的父子关系 |
| **完整性** | 保留所有语义信息，可以还原代码 |
| **标准化** | 同一语言的 AST 结构遵循统一规范 |

---

## 2. AST 的核心概念

### 2.1 节点（Node）

AST 由**节点**组成，每个节点代表代码中的一个语法结构：

```typescript
interface ASTNode {
  type: string;        // 节点类型，如 "FunctionDeclaration"
  loc?: SourceLocation; // 源代码位置信息
  // ... 其他属性，因节点类型而异
}
```

### 2.2 节点类型层次

```
Node（基类）
├── Statement（语句）
│   ├── ExpressionStatement
│   ├── IfStatement
│   ├── ForStatement
│   ├── ReturnStatement
│   └── ...
├── Expression（表达式）
│   ├── Identifier
│   ├── Literal
│   ├── BinaryExpression
│   ├── CallExpression
│   └── ...
├── Declaration（声明）
│   ├── VariableDeclaration
│   ├── FunctionDeclaration
│   ├── ClassDeclaration
│   └── ...
└── Pattern（模式）
    ├── ArrayPattern
    ├── ObjectPattern
    └── ...
```

### 2.3 遍历（Traversal）

遍历 AST 是分析代码的核心操作：

```javascript
// 深度优先遍历
function traverse(node, visitor) {
  // 访问当前节点
  visitor(node);
  
  // 递归遍历子节点
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (isNode(child)) {
      traverse(child, visitor);
    } else if (Array.isArray(child)) {
      child.forEach(c => isNode(c) && traverse(c, visitor));
    }
  }
}
```

### 2.4 访问者模式（Visitor Pattern）

处理不同类型节点的标准模式：

```javascript
const visitor = {
  FunctionDeclaration(node) {
    console.log('发现函数:', node.id.name);
  },
  IfStatement(node) {
    console.log('发现条件语句');
  },
  CallExpression(node) {
    console.log('发现函数调用');
  }
};

traverse(ast, visitor);
```

---

## 3. AST 节点类型详解

### 3.1 JavaScript/TypeScript 主要节点类型

#### 3.1.1 程序结构

```javascript
// Program - 整个程序的根节点
{
  type: "Program",
  body: [...],          // 顶层语句数组
  sourceType: "module"  // "script" 或 "module"
}
```

#### 3.1.2 变量声明

```javascript
// 代码: const x = 1, y = 2;

{
  type: "VariableDeclaration",
  kind: "const",        // "var" | "let" | "const"
  declarations: [
    {
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "x" },
      init: { type: "NumericLiteral", value: 1 }
    },
    {
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "y" },
      init: { type: "NumericLiteral", value: 2 }
    }
  ]
}
```

#### 3.1.3 函数声明

```javascript
// 代码: function add(a, b) { return a + b; }

{
  type: "FunctionDeclaration",
  id: { type: "Identifier", name: "add" },
  params: [
    { type: "Identifier", name: "a" },
    { type: "Identifier", name: "b" }
  ],
  body: {
    type: "BlockStatement",
    body: [
      {
        type: "ReturnStatement",
        argument: {
          type: "BinaryExpression",
          operator: "+",
          left: { type: "Identifier", name: "a" },
          right: { type: "Identifier", name: "b" }
        }
      }
    ]
  },
  async: false,
  generator: false
}
```

#### 3.1.4 箭头函数

```javascript
// 代码: const add = (a, b) => a + b;

{
  type: "VariableDeclaration",
  kind: "const",
  declarations: [{
    type: "VariableDeclarator",
    id: { type: "Identifier", name: "add" },
    init: {
      type: "ArrowFunctionExpression",
      params: [
        { type: "Identifier", name: "a" },
        { type: "Identifier", name: "b" }
      ],
      body: {
        type: "BinaryExpression",
        operator: "+",
        left: { type: "Identifier", name: "a" },
        right: { type: "Identifier", name: "b" }
      },
      expression: true  // 没有 {} 包裹的简写形式
    }
  }]
}
```

#### 3.1.5 条件语句

```javascript
// 代码: if (x > 0) { return x; } else { return -x; }

{
  type: "IfStatement",
  test: {
    type: "BinaryExpression",
    operator: ">",
    left: { type: "Identifier", name: "x" },
    right: { type: "NumericLiteral", value: 0 }
  },
  consequent: {
    type: "BlockStatement",
    body: [{
      type: "ReturnStatement",
      argument: { type: "Identifier", name: "x" }
    }]
  },
  alternate: {
    type: "BlockStatement",
    body: [{
      type: "ReturnStatement",
      argument: {
        type: "UnaryExpression",
        operator: "-",
        argument: { type: "Identifier", name: "x" }
      }
    }]
  }
}
```

#### 3.1.6 循环语句

```javascript
// 代码: for (let i = 0; i < n; i++) { sum += i; }

{
  type: "ForStatement",
  init: {
    type: "VariableDeclaration",
    kind: "let",
    declarations: [{
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "i" },
      init: { type: "NumericLiteral", value: 0 }
    }]
  },
  test: {
    type: "BinaryExpression",
    operator: "<",
    left: { type: "Identifier", name: "i" },
    right: { type: "Identifier", name: "n" }
  },
  update: {
    type: "UpdateExpression",
    operator: "++",
    argument: { type: "Identifier", name: "i" }
  },
  body: {
    type: "BlockStatement",
    body: [...]
  }
}
```

#### 3.1.7 函数调用

```javascript
// 代码: console.log("hello", 123);

{
  type: "CallExpression",
  callee: {
    type: "MemberExpression",
    object: { type: "Identifier", name: "console" },
    property: { type: "Identifier", name: "log" },
    computed: false
  },
  arguments: [
    { type: "StringLiteral", value: "hello" },
    { type: "NumericLiteral", value: 123 }
  ]
}
```

#### 3.1.8 JSX 元素

```javascript
// 代码: <Button onClick={handleClick} disabled>Submit</Button>

{
  type: "JSXElement",
  openingElement: {
    type: "JSXOpeningElement",
    name: { type: "JSXIdentifier", name: "Button" },
    attributes: [
      {
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name: "onClick" },
        value: {
          type: "JSXExpressionContainer",
          expression: { type: "Identifier", name: "handleClick" }
        }
      },
      {
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name: "disabled" },
        value: null  // 布尔属性，无值
      }
    ],
    selfClosing: false
  },
  closingElement: {
    type: "JSXClosingElement",
    name: { type: "JSXIdentifier", name: "Button" }
  },
  children: [
    { type: "JSXText", value: "Submit" }
  ]
}
```

### 3.2 节点类型速查表

| 类别 | 节点类型 | 说明 |
|------|---------|------|
| **程序** | Program | 根节点 |
| **声明** | VariableDeclaration | 变量声明 |
| | FunctionDeclaration | 函数声明 |
| | ClassDeclaration | 类声明 |
| | ImportDeclaration | 导入声明 |
| | ExportDeclaration | 导出声明 |
| **语句** | ExpressionStatement | 表达式语句 |
| | BlockStatement | 块语句 {} |
| | IfStatement | if 语句 |
| | SwitchStatement | switch 语句 |
| | ForStatement | for 循环 |
| | WhileStatement | while 循环 |
| | ReturnStatement | return 语句 |
| | TryStatement | try-catch 语句 |
| **表达式** | Identifier | 标识符 |
| | Literal | 字面量 |
| | BinaryExpression | 二元表达式 |
| | UnaryExpression | 一元表达式 |
| | CallExpression | 函数调用 |
| | MemberExpression | 成员访问 |
| | ArrowFunctionExpression | 箭头函数 |
| | ConditionalExpression | 三元表达式 |
| | ArrayExpression | 数组 [] |
| | ObjectExpression | 对象 {} |
| **JSX** | JSXElement | JSX 元素 |
| | JSXFragment | JSX 片段 <></> |
| | JSXAttribute | JSX 属性 |
| | JSXExpressionContainer | JSX 表达式 {} |

---

## 4. AST 的生成过程

### 4.1 编译器前端流程

```
源代码 (Source Code)
    │
    │ 词法分析 (Lexical Analysis)
    ▼
Token 流 (Token Stream)
    │
    │ 语法分析 (Syntax Analysis / Parsing)
    ▼
   AST (Abstract Syntax Tree)
```

### 4.2 词法分析（Lexer/Tokenizer）

将源代码字符串分割成 **Token（词法单元）**：

```javascript
// 源代码
const x = 1 + 2;

// Token 流
[
  { type: 'Keyword', value: 'const' },
  { type: 'Identifier', value: 'x' },
  { type: 'Punctuator', value: '=' },
  { type: 'Numeric', value: '1' },
  { type: 'Punctuator', value: '+' },
  { type: 'Numeric', value: '2' },
  { type: 'Punctuator', value: ';' },
]
```

### 4.3 语法分析（Parser）

根据语法规则，将 Token 流构建成 AST：

```
词法单元                    AST 节点
---------                  --------
const                  ┌─► VariableDeclaration (kind: const)
x                      │       └─► VariableDeclarator
=                      │             ├─► Identifier (x)
1 + 2                  │             └─► BinaryExpression
;                      └──────────────────►  ├─► NumericLiteral (1)
                                             └─► NumericLiteral (2)
```

### 4.4 使用 Babel 解析

```javascript
import { parse } from '@babel/parser';

const code = `const add = (a, b) => a + b;`;

const ast = parse(code, {
  sourceType: 'module',
  plugins: [
    'jsx',           // 支持 JSX
    'typescript',    // 支持 TypeScript
  ]
});

console.log(JSON.stringify(ast, null, 2));
```

---

## 5. AST 在代码分析中的应用

### 5.1 应用场景

```
            AST
             │
    ┌────────┼────────┬────────┬────────┐
    │        │        │        │        │
    ▼        ▼        ▼        ▼        ▼
  代码      代码      代码     代码      代码
  转换      格式化    检查     压缩      统计
(Babel)  (Prettier) (ESLint) (Terser)  (分析)
```

### 5.2 代码转换（Babel）

```javascript
// 输入: 箭头函数
const add = (a, b) => a + b;

// AST 转换规则: ArrowFunctionExpression → FunctionExpression

// 输出: 普通函数
var add = function(a, b) {
  return a + b;
};
```

### 5.3 代码格式化（Prettier）

```javascript
// 输入（混乱格式）
const   obj={a:1,b:2,c:3}

// AST → 标准化输出
const obj = {
  a: 1,
  b: 2,
  c: 3,
};
```

### 5.4 代码检查（ESLint）

```javascript
// 规则: no-unused-vars

function foo(a, b) {  // 报错: 'b' is defined but never used
  return a;
}

// ESLint 通过遍历 AST 检测:
// 1. 收集所有 Identifier 节点（声明）
// 2. 收集所有 Identifier 节点（使用）
// 3. 对比找出未使用的变量
```

### 5.5 代码统计

```javascript
// 统计函数数量、圈复杂度等

function analyzeCode(ast) {
  let functionCount = 0;
  let complexity = 1;
  
  traverse(ast, {
    FunctionDeclaration() { functionCount++; },
    ArrowFunctionExpression() { functionCount++; },
    IfStatement() { complexity++; },
    ConditionalExpression() { complexity++; },
    ForStatement() { complexity++; },
    WhileStatement() { complexity++; },
  });
  
  return { functionCount, complexity };
}
```

---

## 6. AST 与代码相似度检测

### 6.1 为什么用 AST 检测相似度

| 方法 | 优点 | 缺点 |
|------|------|------|
| **文本比较** | 简单快速 | 对格式、变量名敏感 |
| **Token 比较** | 忽略格式 | 对顺序敏感 |
| **AST 比较** | 结构化、忽略表面差异 | 计算复杂度较高 |

### 6.2 AST 相似度检测方法

#### 方法一：树编辑距离

计算将一棵树转换为另一棵树所需的最小编辑操作数：

```
树 A                树 B
  F                   F
 / \                 / \
A   B       →       A   C    编辑距离 = 1（修改 B→C）
```

#### 方法二：结构签名对比

将 AST 节点转换为规范化签名：

```javascript
// 代码 A
const add = (a, b) => a + b;

// 代码 B（变量名不同）
const sum = (x, y) => x + y;

// 规范化签名（相同）
"VariableDeclaration:const → ArrowFunction:2params → BinaryExpression:+"
```

#### 方法三：AST 向量编码（本项目采用）

将 AST 序列化后，用深度学习模型编码为向量：

```
AST → SBT 序列化 → Transformer 编码 → 768维向量 → 余弦相似度
```

### 6.3 处理"语义等价"的差异

| 差异类型 | 示例 | 处理方式 |
|---------|------|---------|
| 变量名不同 | `a + b` vs `x + y` | 泛化为 `_ID_ + _ID_` |
| 顺序不同 | `{a, b}` vs `{b, a}` | 子节点排序后比较 |
| 等价语法 | `function` vs `=>` | 统一为函数节点 |
| 样式值不同 | `color: red` vs `color: blue` | 忽略 JSX 样式属性值 |

---

## 7. 实战：AST 序列化与向量编码

### 7.1 SBT (Structure-Based Traversal) 格式

SBT 是一种将树结构序列化为字符串的方法，保留结构信息：

```javascript
// 源代码
function add(a, b) {
  return a + b;
}

// SBT 序列化
( FunctionDeclaration 
    ( Identifier[add] ) 
    ( Identifier[a] ) 
    ( Identifier[b] ) 
    ( BlockStatement 
        ( ReturnStatement 
            ( BinaryExpression[+] 
                ( Identifier[a] ) 
                ( Identifier[b] ) 
            ) 
        ) 
    ) 
)

// 泛化后的 SBT（用于相似度比较）
( FunctionDeclaration 
    ( _ID_ ) 
    ( _ID_ ) 
    ( _ID_ ) 
    ( BlockStatement 
        ( ReturnStatement 
            ( BinaryExpression[+] 
                ( _ID_ ) 
                ( _ID_ ) 
            ) 
        ) 
    ) 
)
```

### 7.2 序列化实现

```typescript
function astToSBT(node: ASTNode, config: Config): string {
  let result = `( ${node.type}`;
  
  // 添加关键属性值
  if (node.operator) {
    result += `[${node.operator}]`;
  }
  
  // 泛化处理
  if (node.type === 'Identifier') {
    result += config.generalizeIdentifiers ? '[_ID_]' : `[${node.name}]`;
  }
  
  // 递归处理子节点
  const children = getChildren(node);
  if (config.ignoreOrder) {
    children.sort((a, b) => astToSBT(a, config).localeCompare(astToSBT(b, config)));
  }
  
  for (const child of children) {
    result += ' ' + astToSBT(child, config);
  }
  
  result += ' )';
  return result;
}
```

### 7.3 向量编码

```python
def encode_ast_sbt(self, sbt_string: str) -> np.ndarray:
    """
    使用 Transformer 模型将 SBT 字符串编码为向量
    """
    # 1. Tokenize
    inputs = self.tokenizer(
        sbt_string,
        return_tensors='pt',
        max_length=512,
        truncation=True
    )
    
    # 2. 编码
    with torch.no_grad():
        outputs = self.model(**inputs)
        
        # 使用 [CLS] token 的向量作为整体表示
        cls_vector = outputs.last_hidden_state[:, 0, :]
        
    return cls_vector.numpy()  # 768 维向量
```

### 7.4 相似度计算

```python
def calculate_ast_similarity(ast1: str, ast2: str) -> float:
    """计算两个 AST 的相似度"""
    # 1. 序列化为 SBT
    sbt1 = serialize_to_sbt(ast1)
    sbt2 = serialize_to_sbt(ast2)
    
    # 2. 编码为向量
    vec1 = encode_ast_sbt(sbt1)
    vec2 = encode_ast_sbt(sbt2)
    
    # 3. 计算余弦相似度
    similarity = cosine_similarity([vec1], [vec2])[0][0]
    
    return similarity  # 0.0 ~ 1.0
```

### 7.5 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                        代码 A                                │
│  const add = (a, b) => a + b;                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Babel 解析为 AST                         │
│  {                                                          │
│    type: "Program",                                         │
│    body: [{                                                 │
│      type: "VariableDeclaration",                          │
│      declarations: [{ ... }]                               │
│    }]                                                       │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SBT 序列化（泛化）                          │
│  ( Program ( VariableDeclaration[const]                     │
│      ( VariableDeclarator ( _ID_ )                          │
│        ( ArrowFunctionExpression[params:2]                  │
│          ( _ID_ ) ( _ID_ )                                  │
│          ( BinaryExpression[+] ( _ID_ ) ( _ID_ ) )          │
│        )                                                    │
│      )                                                      │
│    )                                                        │
│  )                                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 CodeBERT 向量编码                            │
│  [0.12, -0.34, 0.56, ..., 0.78]  (768 维)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   余弦相似度     │ ← 与代码 B 的向量比较
                    │   0.0 ~ 1.0     │
                    └─────────────────┘
```

---

## 8. 常用 AST 工具

### 8.1 JavaScript/TypeScript

| 工具 | 用途 | 特点 |
|------|------|------|
| **@babel/parser** | 解析 | 支持最新语法、JSX、TypeScript |
| **@babel/traverse** | 遍历 | 访问者模式 |
| **@babel/types** | 类型判断 | 节点类型工具函数 |
| **@babel/generator** | 生成 | AST → 代码 |
| **acorn** | 解析 | 轻量级、快速 |
| **esprima** | 解析 | 符合 ESTree 标准 |
| **typescript** | 解析 | TypeScript 官方解析器 |

### 8.2 Python

| 工具 | 用途 |
|------|------|
| **ast** | Python 内置 AST 模块 |
| **tree-sitter** | 通用解析器（支持多语言） |
| **astor** | AST → 代码 |

### 8.3 多语言通用

| 工具 | 支持语言 |
|------|---------|
| **tree-sitter** | 40+ 语言 |
| **ANTLR** | 几乎所有语言 |
| **Roslyn** | C#, VB.NET |

### 8.4 在线工具

- **AST Explorer**: https://astexplorer.net/
  - 支持多种语言和解析器
  - 实时预览 AST 结构
  - 可以编写转换代码

### 8.5 示例：使用 AST Explorer

1. 打开 https://astexplorer.net/
2. 选择语言（如 JavaScript）
3. 选择解析器（如 @babel/parser）
4. 在左侧输入代码
5. 右侧实时显示 AST 结构

---

## 总结

### AST 的核心价值

1. **结构化表示**：将文本代码转换为可程序化处理的树结构
2. **语义保留**：抽象掉表面语法，保留程序的本质含义
3. **通用基础**：编译、转换、检查、格式化等工具的共同基础

### AST 在代码相似度中的优势

1. **忽略表面差异**：变量名、格式、注释不影响比较
2. **结构化比较**：基于树结构而非文本
3. **可定制泛化**：灵活控制哪些差异应被忽略

### 最佳实践

1. 选择合适的解析器（Babel 适合 JS/TS/JSX）
2. 使用访问者模式处理不同节点
3. 根据需求选择泛化级别
4. 结合向量编码实现智能相似度检测
