"""
FastAPI 后端 API 服务
提供代码相似度对比的 REST API 接口
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn

from code_similarity import CodeSimilarityDetector

# 创建 FastAPI 应用
app = FastAPI(
    title="GraphCodeBERT 代码相似度 API",
    description="基于 GraphCodeBERT 的代码语义相似度检测服务",
    version="1.0.0"
)

# 配置 CORS（允许前端跨域访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量：延迟加载模型
detector: Optional[CodeSimilarityDetector] = None


def get_detector() -> CodeSimilarityDetector:
    """获取或初始化检测器（延迟加载）"""
    global detector
    if detector is None:
        raise HTTPException(
            status_code=503, 
            detail="模型正在加载中，请稍后再试。首次启动需要下载约500MB的模型文件。"
        )
    return detector


# 模型加载状态
model_loading = False
model_error: Optional[str] = None


async def load_model_background():
    """后台加载模型"""
    global detector, model_loading, model_error
    if detector is not None or model_loading:
        return
    
    model_loading = True
    try:
        print("正在后台加载 GraphCodeBERT 模型...")
        detector = CodeSimilarityDetector()
        print("模型加载完成！")
    except Exception as e:
        model_error = str(e)
        print(f"模型加载失败: {e}")
    finally:
        model_loading = False


# ==================== 请求/响应模型 ====================

class CodePairRequest(BaseModel):
    """代码对比请求"""
    code1: str  # 第一段代码
    code2: str  # 第二段代码
    lang: str = "c"  # 编程语言，默认 C


class CodeAnalysisRequest(BaseModel):
    """代码分析请求"""
    code: str  # 代码内容
    lang: str = "c"  # 编程语言


class SimilarityResponse(BaseModel):
    """相似度响应"""
    similarity: float  # 校准后的相似度分数 (0-1)
    similarity_percent: float  # 相似度百分比 (0-100)
    raw_cosine_similarity: float  # 原始余弦相似度
    text_similarity: float  # 文本 Jaccard 相似度
    code1_analysis: Dict[str, Any]  # 代码1的分析结果
    code2_analysis: Dict[str, Any]  # 代码2的分析结果
    interpretation: str  # 相似度解释


class AnalysisResponse(BaseModel):
    """代码分析响应"""
    cleaned_code: str  # 清理后的代码
    token_count: int  # Token 数量
    dfg_edges: int  # DFG 边数量
    dfg_string: str  # DFG 字符串表示


class BatchCompareRequest(BaseModel):
    """批量对比请求"""
    query_code: str  # 查询代码
    code_list: List[str]  # 待比较的代码列表
    lang: str = "c"  # 编程语言


class BatchCompareResult(BaseModel):
    """批量对比单个结果"""
    index: int  # 代码索引
    similarity: float  # 相似度
    code_preview: str  # 代码预览


class BatchCompareResponse(BaseModel):
    """批量对比响应"""
    results: List[BatchCompareResult]  # 结果列表（按相似度降序）


class SemanticDiffRequest(BaseModel):
    """语义 Diff 请求"""
    code1: str  # 原始代码
    code2: str  # 待比较代码
    lang: str = "c"  # 编程语言
    equivalent_threshold: float = 0.85  # 语义等价阈值


class LineAlignment(BaseModel):
    """行对齐信息"""
    line1: int  # 代码1的行号
    line2: int  # 代码2的行号
    content1: str  # 代码1的行内容
    content2: str  # 代码2的行内容
    similarity: float  # 行相似度
    type: str  # 对齐类型: exact, equivalent, different
    is_semantic_equivalent: bool  # 是否语义等价


class UnmatchedLine(BaseModel):
    """未匹配的行"""
    line: int  # 行号
    content: str  # 行内容


class DiffStats(BaseModel):
    """Diff 统计"""
    overall_similarity: float  # 整体相似度
    total_lines1: int  # 代码1总行数
    total_lines2: int  # 代码2总行数
    exact_matches: int  # 完全匹配的行数
    semantic_equivalent: int  # 语义等价的行数
    different_lines: int  # 不同的行数
    removed_lines: int  # 删除的行数
    added_lines: int  # 新增的行数


class SemanticDiffResponse(BaseModel):
    """语义 Diff 响应"""
    similarity: float  # 整体相似度
    stats: DiffStats  # 统计信息
    alignments: List[LineAlignment]  # 行对齐列表
    removed: List[UnmatchedLine]  # 被删除的行
    added: List[UnmatchedLine]  # 新增的行
    interpretation: str  # 解释文本


class ASTSimilarityRequest(BaseModel):
    """AST 相似度请求"""
    sbt1: str  # 第一个 AST 的 SBT 序列化字符串
    sbt2: str  # 第二个 AST 的 SBT 序列化字符串


class CodeUnitItem(BaseModel):
    """代码单元"""
    name: str
    type: str
    code: str
    lineCount: int


class HierarchicalCompareRequest(BaseModel):
    """函数级分层编码比较请求"""
    units1: List[CodeUnitItem]
    units2: List[CodeUnitItem]
    lang: str = "javascript"


class UnitMatchResult(BaseModel):
    """函数单元匹配结果"""
    unit_a: str
    type_a: str
    lines_a: int
    unit_b: str
    type_b: str
    lines_b: int
    similarity: float
    similarity_percent: float
    weight: float


class EncodingDetail(BaseModel):
    """单个代码单元的编码详情"""
    name: str
    type: str
    lines: int
    token_count: int
    effective_tokens: int
    truncated: bool
    vector_norm: float
    dfg_string: str = ""


class HierarchicalCompareResponse(BaseModel):
    """函数级分层编码比较响应"""
    similarity: float
    similarity_percent: float
    matches: List[UnitMatchResult]
    unmatched_a: List[str]
    unmatched_b: List[str]
    total_weight: float
    encoding_details_a: List[EncodingDetail]
    encoding_details_b: List[EncodingDetail]
    similarity_matrix: List[List[float]]
    unit_names_a: List[str]
    unit_names_b: List[str]
    interpretation: str


class VectorDebugInfo(BaseModel):
    """向量编码调试信息"""
    cls_norm: float
    mean_norm: float
    combined_norm: float
    bpe_tokens: int
    windows: int

class ASTSimilarityResponse(BaseModel):
    """AST 相似度响应"""
    similarity: float  # 相似度 (0-1)
    similarity_percent: float  # 相似度百分比 (0-100)
    interpretation: str  # 相似度解释
    sbt1_tokens: int  # SBT1 的 token 数
    sbt2_tokens: int  # SBT2 的 token 数
    code1_vector: Optional[VectorDebugInfo] = None
    code2_vector: Optional[VectorDebugInfo] = None


# ==================== API 端点 ====================

@app.get("/")
async def root():
    """API 根路径"""
    return {
        "message": "GraphCodeBERT 代码相似度 API",
        "version": "1.0.0",
        "endpoints": {
            "/compare": "POST - 比较两段代码的相似度",
            "/ast-similarity": "POST - 基于 AST 编码的结构相似度比较（推荐）",
            "/semantic-diff": "POST - 基于语义的代码差异分析",
            "/analyze": "POST - 分析单段代码的结构",
            "/batch-compare": "POST - 批量比较代码相似度",
            "/health": "GET - 健康检查",
            "/model-status": "GET - 模型加载状态",
        }
    }


@app.on_event("startup")
async def startup_event():
    """服务启动时开始加载模型"""
    import asyncio
    asyncio.create_task(load_model_background())


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy", 
        "model_loaded": detector is not None,
        "model_loading": model_loading,
        "model_error": model_error
    }


@app.get("/model-status")
async def model_status():
    """获取模型加载状态"""
    if detector is not None:
        return {"status": "ready", "message": "模型已就绪，可以开始使用"}
    elif model_loading:
        return {"status": "loading", "message": "模型正在加载中，请稍候...（首次需下载约500MB）"}
    elif model_error:
        return {"status": "error", "message": f"模型加载失败: {model_error}"}
    else:
        return {"status": "not_started", "message": "模型尚未开始加载"}


@app.post("/compare", response_model=SimilarityResponse)
async def compare_codes(request: CodePairRequest):
    """
    比较两段代码的语义相似度
    
    - **code1**: 第一段代码
    - **code2**: 第二段代码
    - **lang**: 编程语言 (python, c, java, javascript 等)
    
    返回相似度分数和详细分析结果
    """
    try:
        det = get_detector()
        
        # 计算相似度（返回包含中间变量的字典）
        sim_result = det.calculate_similarity(
            request.code1, 
            request.code2, 
            request.lang
        )
        
        # 分析两段代码
        analysis1 = det.analyze_code(request.code1, request.lang)
        analysis2 = det.analyze_code(request.code2, request.lang)
        
        # 生成解释文本
        interpretation = get_similarity_interpretation(sim_result["similarity"])
        
        return SimilarityResponse(
            similarity=sim_result["similarity"],
            similarity_percent=round(sim_result["similarity"] * 100, 2),
            raw_cosine_similarity=round(sim_result["raw_cosine_similarity"], 6),
            text_similarity=round(sim_result["text_similarity"], 6),
            code1_analysis={
                "token_count": analysis1["token_count"],
                "dfg_edges": analysis1["dfg_edges"],
            },
            code2_analysis={
                "token_count": analysis2["token_count"],
                "dfg_edges": analysis2["dfg_edges"],
            },
            interpretation=interpretation
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ast-similarity", response_model=ASTSimilarityResponse)
async def compare_ast(request: ASTSimilarityRequest):
    """
    比较两个 AST 的结构相似度（基于 SBT 序列化）
    
    - **sbt1**: 第一个 AST 的 SBT (Structure-Based Traversal) 序列化字符串
    - **sbt2**: 第二个 AST 的 SBT 序列化字符串
    
    SBT 格式示例: ( Program ( FunctionDeclaration[params:2] ( _ID_ ) ( BlockStatement ... ) ) )
    
    这个端点直接对 AST 结构进行向量编码和比较：
    1. 将 SBT 字符串输入 CodeBERT 模型
    2. 获取 AST 的向量表示
    3. 计算余弦相似度
    
    返回结构相似度分数
    """
    try:
        det = get_detector()
        
        result = det.calculate_ast_similarity(request.sbt1, request.sbt2, return_debug=True)
        
        similarity = result["similarity"]
        sbt1_tokens = len(request.sbt1.split())
        sbt2_tokens = len(request.sbt2.split())
        interpretation = get_ast_similarity_interpretation(similarity)
        
        return ASTSimilarityResponse(
            similarity=similarity,
            similarity_percent=round(similarity * 100, 2),
            interpretation=interpretation,
            sbt1_tokens=sbt1_tokens,
            sbt2_tokens=sbt2_tokens,
            code1_vector=VectorDebugInfo(**result["code1_vector"]),
            code2_vector=VectorDebugInfo(**result["code2_vector"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare-hierarchical", response_model=HierarchicalCompareResponse)
async def compare_hierarchical(request: HierarchicalCompareRequest):
    """
    函数级分层编码比较

    前端将两份代码分别拆分为函数/组件级别的单元，发送到此接口。
    后端对每个单元单独编码为向量，构建相似度矩阵，使用匈牙利算法做最优匹配，
    再按代码行数加权计算整体相似度。

    优势：
    - 每个函数/组件独立编码，不受 512 token 限制
    - 能看到每个函数的匹配情况（哪个函数跟哪个对应，相似多少）
    - 新增/删除的函数能被识别出来
    """
    try:
        det = get_detector()

        units1_dicts = [{"name": u.name, "type": u.type, "code": u.code, "lineCount": u.lineCount} for u in request.units1]
        units2_dicts = [{"name": u.name, "type": u.type, "code": u.code, "lineCount": u.lineCount} for u in request.units2]

        result = det.hierarchical_compare(units1_dicts, units2_dicts, request.lang)

        matches = [UnitMatchResult(**m) for m in result["matches"]]

        return HierarchicalCompareResponse(
            similarity=result["similarity"],
            similarity_percent=result["similarity_percent"],
            matches=matches,
            unmatched_a=result["unmatched_a"],
            unmatched_b=result["unmatched_b"],
            total_weight=result["total_weight"],
            encoding_details_a=[EncodingDetail(**d) for d in result["encoding_details_a"]],
            encoding_details_b=[EncodingDetail(**d) for d in result["encoding_details_b"]],
            similarity_matrix=result["similarity_matrix"],
            unit_names_a=result["unit_names_a"],
            unit_names_b=result["unit_names_b"],
            interpretation=result["interpretation"],
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class TreeSitterSplitRequest(BaseModel):
    """Tree-sitter 代码拆分请求"""
    code1: str
    code2: str
    lang: str = "javascript"


class CodeUnitResponse(BaseModel):
    """代码单元响应"""
    name: str
    type: str
    code: str
    startLine: int
    endLine: int
    lineCount: int


class TreeSitterSplitResponse(BaseModel):
    """Tree-sitter 拆分响应"""
    units1: List[CodeUnitResponse]
    units2: List[CodeUnitResponse]


@app.post("/split-with-treesitter", response_model=TreeSitterSplitResponse)
async def split_with_treesitter(request: TreeSitterSplitRequest):
    """
    使用 Tree-sitter 在后端拆分代码
    
    优势：
    - CST 保留所有源代码细节，不丢失任何代码
    - 节点边界精确，基于语法结构
    - 支持多种语言
    """
    try:
        from parser.code_splitter import TreeSitterCodeSplitter
        
        splitter = TreeSitterCodeSplitter(request.lang)
        units1 = splitter.split_code(request.code1, max_chars=500)
        units2 = splitter.split_code(request.code2, max_chars=500)
        
        return TreeSitterSplitResponse(
            units1=[CodeUnitResponse(**u) for u in units1],
            units2=[CodeUnitResponse(**u) for u in units2]
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def get_ast_similarity_interpretation(similarity: float) -> str:
    """根据 AST 相似度生成解释文本"""
    if similarity >= 0.95:
        return "AST 结构几乎完全相同，代码结构高度一致"
    elif similarity >= 0.85:
        return "AST 结构非常相似，仅有少量结构差异"
    elif similarity >= 0.70:
        return "AST 结构相似，存在一些结构上的不同"
    elif similarity >= 0.50:
        return "AST 结构有一定相似性，但存在明显的结构差异"
    elif similarity >= 0.30:
        return "AST 结构差异较大，可能是不同的实现方式"
    else:
        return "AST 结构差异很大，代码结构完全不同"


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_code(request: CodeAnalysisRequest):
    """
    分析单段代码的结构
    
    - **code**: 代码内容
    - **lang**: 编程语言
    
    返回代码的 Token 数量、DFG 边数量等信息
    """
    try:
        det = get_detector()
        analysis = det.analyze_code(request.code, request.lang)
        
        return AnalysisResponse(
            cleaned_code=analysis["cleaned_code"],
            token_count=analysis["token_count"],
            dfg_edges=analysis["dfg_edges"],
            dfg_string=analysis["dfg_string"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/batch-compare", response_model=BatchCompareResponse)
async def batch_compare(request: BatchCompareRequest):
    """
    批量比较代码相似度
    
    - **query_code**: 查询代码
    - **code_list**: 待比较的代码列表
    - **lang**: 编程语言
    
    返回按相似度降序排列的结果
    """
    try:
        det = get_detector()
        
        # 批量比较
        results = det.find_most_similar(
            request.query_code, 
            request.code_list, 
            request.lang
        )
        
        # 构建响应
        response_results = []
        for idx, sim in results:
            code = request.code_list[idx]
            preview = code[:100] + "..." if len(code) > 100 else code
            response_results.append(BatchCompareResult(
                index=idx,
                similarity=round(sim, 4),
                code_preview=preview.replace("\n", " ")
            ))
        
        return BatchCompareResponse(results=response_results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/preload")
async def preload_model():
    """预加载模型（可在启动时调用以加快首次请求）"""
    try:
        get_detector()
        return {"status": "success", "message": "模型加载完成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/semantic-diff", response_model=SemanticDiffResponse)
async def semantic_diff(request: SemanticDiffRequest):
    """
    基于语义的代码差异分析
    
    与传统的行级 diff 不同，这个接口：
    1. 使用 GraphCodeBERT 计算整体语义相似度
    2. 提取每行的语义向量，计算行级对齐
    3. 区分"语义等价变更"（如变量重命名）和"真实差异"
    
    - **code1**: 原始代码
    - **code2**: 待比较代码  
    - **lang**: 编程语言
    - **equivalent_threshold**: 语义等价阈值（默认0.85）
    
    返回：
    - similarity: 整体相似度
    - stats: 统计信息
    - alignments: 行对齐列表，包含每行的相似度和类型
    - removed: 被删除的行
    - added: 新增的行
    """
    try:
        det = get_detector()
        
        # 调用语义 diff 方法
        result = det.semantic_diff(
            request.code1,
            request.code2,
            request.lang,
            request.equivalent_threshold
        )
        
        # 生成解释文本
        interpretation = get_semantic_diff_interpretation(result)
        
        # 构建响应
        alignments = [
            LineAlignment(
                line1=a['line1'],
                line2=a['line2'],
                content1=a['content1'],
                content2=a['content2'],
                similarity=a['similarity'],
                type=a['type'],
                is_semantic_equivalent=a['is_semantic_equivalent']
            )
            for a in result['alignments']
        ]
        
        removed = [
            UnmatchedLine(line=r['line'], content=r['content'])
            for r in result['removed']
        ]
        
        added = [
            UnmatchedLine(line=a['line'], content=a['content'])
            for a in result['added']
        ]
        
        stats = DiffStats(
            overall_similarity=result['stats']['overall_similarity'],
            total_lines1=result['stats']['total_lines1'],
            total_lines2=result['stats']['total_lines2'],
            exact_matches=result['stats']['exact_matches'],
            semantic_equivalent=result['stats']['semantic_equivalent'],
            different_lines=result['stats']['different_lines'],
            removed_lines=result['stats']['removed_lines'],
            added_lines=result['stats']['added_lines']
        )
        
        return SemanticDiffResponse(
            similarity=result['similarity'],
            stats=stats,
            alignments=alignments,
            removed=removed,
            added=added,
            interpretation=interpretation
        )
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 辅助函数 ====================

def get_similarity_interpretation(similarity: float) -> str:
    """
    根据相似度分数生成解释文本
    """
    if similarity >= 0.95:
        return "极高相似度：两段代码几乎相同，可能是复制或仅有微小改动"
    elif similarity >= 0.85:
        return "高相似度：代码功能和结构高度相似，可能存在代码复用"
    elif similarity >= 0.70:
        return "较高相似度：代码存在明显的相似特征，可能使用了相似的算法或模式"
    elif similarity >= 0.50:
        return "中等相似度：代码有部分相似之处，但也存在显著差异"
    elif similarity >= 0.30:
        return "较低相似度：代码存在少量相似特征，整体差异较大"
    else:
        return "低相似度：两段代码差异明显，功能或结构不同"


def get_semantic_diff_interpretation(result: Dict[str, Any]) -> str:
    """
    根据语义 diff 结果生成解释文本
    """
    stats = result['stats']
    similarity = result['similarity']
    
    parts = []
    
    # 整体相似度描述
    if similarity >= 0.95:
        parts.append(f"两段代码语义高度一致（相似度 {similarity:.1%}）")
    elif similarity >= 0.85:
        parts.append(f"两段代码功能相似（相似度 {similarity:.1%}）")
    elif similarity >= 0.70:
        parts.append(f"两段代码有一定相似性（相似度 {similarity:.1%}）")
    else:
        parts.append(f"两段代码差异较大（相似度 {similarity:.1%}）")
    
    # 变更统计
    if stats['exact_matches'] > 0:
        parts.append(f"完全匹配 {stats['exact_matches']} 行")
    
    if stats['semantic_equivalent'] > 0:
        parts.append(f"语义等价变更 {stats['semantic_equivalent']} 行（如变量重命名、顺序调整等，无需关注）")
    
    if stats['different_lines'] > 0:
        parts.append(f"存在差异的行 {stats['different_lines']} 处")
    
    if stats['removed_lines'] > 0:
        parts.append(f"删除了 {stats['removed_lines']} 行")
    
    if stats['added_lines'] > 0:
        parts.append(f"新增了 {stats['added_lines']} 行")
    
    return "。".join(parts) + "。"


# ==================== 启动服务器 ====================

if __name__ == "__main__":
    print("启动 GraphCodeBERT 代码相似度 API 服务...")
    print("API 文档: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
