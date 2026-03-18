# GraphCodeBERT 代码语义相似度对比工具

基于微软 [GraphCodeBERT](https://huggingface.co/microsoft/graphcodebert-base) 模型的代码语义相似度检测工具，提供可视化 Web 界面。

![GraphCodeBERT Demo](https://img.shields.io/badge/GraphCodeBERT-Code%20Similarity-blue)

## 功能特性

- 🧠 **语义级分析**：使用 GraphCodeBERT 深度学习模型提取代码语义特征
- 🔄 **数据流图提取**：通过 DFG（Data Flow Graph）分析代码的数据流向
- 🎯 **忽略表面差异**：即使变量名、函数名、控制流改变，也能识别相同功能的代码
- 📊 **可视化对比**：提供直观的并排代码对比和相似度展示
- 🌐 **Web 界面**：现代化的 React 前端界面，支持文件上传和代码粘贴

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐   │
│  │  代码上传    │ → │  相似度展示  │ → │  并排代码对比   │   │
│  └─────────────┘   └─────────────┘   └─────────────────┘   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP API
┌────────────────────────────▼────────────────────────────────┐
│                      后端 (FastAPI)                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐   │
│  │  DFG 提取   │ → │ GraphCodeBERT│ → │  余弦相似度     │   │
│  └─────────────┘   │   编码器     │   │    计算        │   │
│                    └─────────────┘   └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 技术原理

### 为什么使用 GraphCodeBERT？

传统的代码比较方法（如字符串匹配、AST 对比）只能识别表面形式的差异，无法理解代码的语义。例如：

```c
// 代码1
int add(int a, int b) { return a + b; }

// 代码2  
int sum(int x, int y) { int result = x + y; return result; }
```

这两段代码功能完全相同，但传统方法会认为它们差异很大。

GraphCodeBERT 通过**数据流图（DFG）** 分析代码的数据流向，提取语义特征：

1. **数据流分析**：关注"数据从哪来、经过什么处理、输出什么"
2. **深度学习编码**：使用 Transformer 将代码转换为高维向量
3. **向量相似度**：通过余弦相似度计算两段代码的语义相似程度

## 快速开始

### 环境要求

- Python 3.8+
- Node.js 16+
- 约 2GB 磁盘空间（用于模型下载）

### 安装步骤

```bash
# 1. 进入项目目录
cd diff-graphcodeBERT

# 2. 安装 Python 依赖
pip install -r backend/requirements.txt

# 3. 安装前端依赖
cd frontend
npm install
cd ..

# 4. 启动服务（或使用启动脚本）
chmod +x start.sh
./start.sh
```

### 手动启动

```bash
# 终端1：启动后端 API
python backend/api.py

# 终端2：启动前端
cd frontend
npm run dev
```

### 访问地址

- **前端界面**：http://localhost:3000
- **API 文档**：http://localhost:8000/docs

## API 接口

### 比较两段代码

```bash
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{
    "code1": "int add(int a, int b) { return a + b; }",
    "code2": "int sum(int x, int y) { return x + y; }",
    "lang": "c"
  }'
```

响应示例：
```json
{
  "similarity": 0.9234,
  "similarity_percent": 92.34,
  "code1_analysis": { "token_count": 15, "dfg_edges": 3 },
  "code2_analysis": { "token_count": 15, "dfg_edges": 3 },
  "interpretation": "高相似度：代码功能和结构高度相似，可能存在代码复用"
}
```

### 其他接口

| 端点 | 方法 | 描述 |
|------|------|------|
| `/compare` | POST | 比较两段代码的相似度 |
| `/analyze` | POST | 分析单段代码的结构 |
| `/batch-compare` | POST | 批量比较代码相似度 |
| `/health` | GET | 健康检查 |
| `/preload` | POST | 预加载模型 |

## 支持的语言

- C/C++
- Python
- Java
- JavaScript
- Go
- Ruby
- PHP

## 项目结构

```
diff-graphcodeBERT/
├── README.md              # 说明文档
├── start.sh               # 一键启动脚本
├── docs/                  # 项目文档
├── backend/               # 后端服务
│   ├── api.py             # FastAPI 后端 API
│   ├── code_similarity.py # 核心相似度计算模块
│   └── requirements.txt   # Python 依赖
└── frontend/              # 前端项目
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── App.css
        ├── index.css
        ├── components/
        │   ├── CodeDiffViewer.tsx
        │   └── CodeDiffViewer.css
        └── utils/
            ├── ASTDiffAnalyzer.ts
            └── ASTSerializer.ts
```

## 应用场景

- **代码抄袭检测**：识别变量名、函数名改变的抄袭代码
- **漏洞代码检测**：与已知漏洞代码库比对
- **代码去重**：在大规模代码库中找出功能重复的代码
- **代码审查**：辅助识别相似的代码模式

## 限制

1. **最大长度**：GraphCodeBERT 最多处理 512 个 token
2. **首次加载**：模型约 500MB，首次启动需要下载
3. **计算资源**：建议使用 GPU 加速（可选）

## 参考

- [博客原文](https://www.cnblogs.com/theseventhson/p/18211242)
- [GraphCodeBERT 论文](https://arxiv.org/abs/2009.08366)
- [Hugging Face 模型](https://huggingface.co/microsoft/graphcodebert-base)
- [GitHub 官方仓库](https://github.com/microsoft/CodeBERT)
