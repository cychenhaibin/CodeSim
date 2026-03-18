// ========================================================================
// utils/ASTDiffAnalyzer.ts
// AST 差异分析器 - 核心模块
// 负责解析代码生成AST，通过结构签名比较找出真正的功能和结构差异
// 忽略：顺序差异、变量名差异、样式值差异等不影响功能的变化
// ========================================================================

// 导入 Babel 解析器，用于将代码字符串转换为 AST
import { parse, ParserOptions } from '@babel/parser';
// 导入 Babel 遍历器，用于遍历 AST 树的每个节点
import traverse from '@babel/traverse';
// 导入 Babel 类型工具，用于判断节点类型
import * as t from '@babel/types';
// 导入 diff 库的 diffLines 函数，用于文本行级差异比较
import { diffLines, Change } from 'diff';

// ============ 结构签名相关配置 ============

/**
 * 影响功能的核心节点类型
 * 只有这些节点类型的变化才被视为结构/功能差异
 */
const STRUCTURAL_NODE_TYPES = new Set([
  // 函数相关
  'FunctionDeclaration',
  'FunctionExpression', 
  'ArrowFunctionExpression',
  'ClassMethod',
  'ObjectMethod',
  
  // 控制流相关
  'IfStatement',
  'SwitchStatement',
  'SwitchCase',
  'ConditionalExpression',
  
  // 循环相关
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  
  // 类相关
  'ClassDeclaration',
  'ClassExpression',
  'ClassBody',
  
  // JSX 结构相关
  'JSXElement',
  'JSXFragment',
  'JSXOpeningElement',
  'JSXClosingElement',
  
  // 导入导出
  'ImportDeclaration',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
  
  // 错误处理
  'TryStatement',
  'CatchClause',
  'ThrowStatement',
  
  // 异步相关
  'AwaitExpression',
  'YieldExpression',
  
  // 调用相关（只关注调用结构，不关注具体参数）
  'CallExpression',
  'NewExpression',
  
  // 返回和表达式
  'ReturnStatement',
  'BlockStatement',
  'ExpressionStatement',
]);

/**
 * 应该忽略的 JSX 属性名（样式相关）
 * 这些属性值的变化不影响功能结构
 */
const IGNORED_JSX_ATTRIBUTES = new Set([
  'style',
  'className',
  'class',
  'width',
  'height',
  'minWidth',
  'maxWidth', 
  'minHeight',
  'maxHeight',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'color',
  'backgroundColor',
  'background',
  'border',
  'borderWidth',
  'borderColor',
  'borderRadius',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'textAlign',
  'display',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'zIndex',
  'opacity',
  'flex',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'transform',
  'transition',
  'animation',
  'boxShadow',
  'overflow',
  'cursor',
]);

// ============ 导出所有类型定义 ============

/**
 * 调试步骤类型
 * 用于记录分析过程中每一步的详细信息
 */
export interface DebugStep {
  stepNumber: number;    // 步骤序号（从1开始）
  title: string;         // 步骤标题（如"解析旧代码AST"）
  description: string;   // 步骤描述（详细说明这一步做了什么）
  timestamp: number;     // 时间戳（用于计算耗时）
  data: unknown;         // 这一步产生的数据（用于调试展示）
  duration?: number;     // 这一步的耗时（毫秒）
}

/**
 * 调试信息
 * 包含整个分析过程的调试数据
 */
export interface DebugInfo {
  steps: DebugStep[];              // 所有分析步骤的数组
  totalDuration: number;           // 总耗时（毫秒）
  oldASTNodes?: ASTNodeInfo[];     // 旧代码的AST节点列表（用于可视化）
  newASTNodes?: ASTNodeInfo[];     // 新代码的AST节点列表（用于可视化）
  lcsMatchPairs?: LCSMatchPair[];  // LCS匹配的节点对列表
}

/**
 * AST 节点信息
 * 用于在调试面板中可视化展示AST节点
 */
export interface ASTNodeInfo {
  index: number;      // 节点在序列中的索引（前序遍历顺序）
  type: string;       // 节点类型（如 FunctionDeclaration, Identifier 等）
  depth: number;      // 节点在树中的深度（根节点为0）
  path: string;       // 节点的路径（如 "Program > FunctionDeclaration > Identifier"）
  matched?: boolean;  // 是否被LCS算法匹配上（true=匹配，false=差异）
}

/**
 * LCS 匹配对
 * 表示旧代码和新代码中一对匹配的节点
 */
export interface LCSMatchPair {
  oldIndex: number;   // 在旧代码节点序列中的索引
  newIndex: number;   // 在新代码节点序列中的索引
  nodeType: string;   // 匹配的节点类型
}

/**
 * 差异分析结果
 * analyzeDiff 方法的返回值，包含所有分析结果
 */
export interface DiffResult {
  lineChanges: Change[];                    // 文本行级差异（来自diff库）
  astChanges: ASTChangeDetail[];            // AST语义级差异（导入/函数/类的变化）
  statistics: DiffStatistics;               // 行级统计信息
  semanticSimilarity: number;               // 基于语义结构的相似度 0-100
  astStructureSimilarity: number;           // AST树结构相似度 0-100（核心指标）
  astStructureChanges: ASTStructureChange[]; // AST节点级差异摘要
  debugInfo?: DebugInfo;                    // 调试信息（仅调试模式下存在）
}

/**
 * AST 树节点级差异
 * 描述某种类型的节点被添加或删除
 */
export interface ASTStructureChange {
  type: 'added' | 'removed' | 'modified';  // 变化类型：新增/移除/修改
  nodeType: string;                         // AST节点类型（如 Identifier, StringLiteral）
  path: string;                             // 节点路径（暂未使用）
  description: string;                      // 人类可读的描述（如"新增 3 个 Identifier 节点"）
}

/**
 * AST 变化详情
 * 描述代码语义层面的变化（导入、函数、类、变量）
 */
export interface ASTChangeDetail {
  type: 'added' | 'removed' | 'modified';                              // 变化类型
  category: 'import' | 'function' | 'class' | 'variable' | 'jsx' | 'other'; // 变化类别
  description: string;                                                  // 人类可读的描述
  lineNumber?: number;                                                  // 对应的行号（可选）
  severity: 'high' | 'medium' | 'low';                                 // 严重程度（用于UI展示颜色）
}

/**
 * 差异统计信息
 * 统计代码行的增删改情况
 */
export interface DiffStatistics {
  totalLines: number;     // 总行数
  addedLines: number;     // 新增行数
  removedLines: number;   // 删除行数
  modifiedLines: number;  // 修改行数（= addedLines + removedLines）
  similarity: number;     // 基于行的相似度百分比
}

/**
 * 代码结构
 * 存储从AST中提取的代码结构信息
 */
interface CodeStructure {
  imports: string[];         // 导入的模块列表
  functions: FunctionInfo[]; // 函数列表
  classes: ClassInfo[];      // 类列表
  variables: VariableInfo[]; // 变量列表
  jsx: JSXInfo[];            // JSX组件列表
}

/**
 * 函数信息
 */
interface FunctionInfo {
  name: string;  // 函数名
  line: number;  // 所在行号
}

/**
 * 类信息
 */
interface ClassInfo {
  name: string;       // 类名
  methods: string[];  // 方法名列表
  properties: string[]; // 属性名列表
  line: number;       // 所在行号
}

/**
 * 变量信息
 */
interface VariableInfo {
  name: string;  // 变量名
  line: number;  // 所在行号
}

/**
 * JSX 组件信息
 */
interface JSXInfo {
  component: string;  // 组件名（如 div, Button）
  line: number;       // 所在行号
}

/**
 * AST差异分析器类
 * 核心类，提供代码差异分析功能
 */
export class ASTDiffAnalyzer {
  /**
   * Babel 解析器配置选项
   * 配置支持的语法特性
   */
  private parserOptions: ParserOptions = {
    sourceType: 'module',  // 源码类型：ES模块
    plugins: [
      'typescript',        // 支持 TypeScript 语法
      'jsx',               // 支持 JSX 语法
      'decorators-legacy', // 支持装饰器语法（旧版）
      'classProperties',   // 支持类属性语法
      'objectRestSpread',  // 支持对象展开运算符
    ],
  };

  /** 调试模式开关，启用后会收集分析过程的详细数据 */
  private debugMode: boolean = false;
  /** 调试步骤记录数组 */
  private debugSteps: DebugStep[] = [];
  /** 调试开始时间戳 */
  private debugStartTime: number = 0;

  /**
   * 启用调试模式
   * 调用后会收集分析过程的详细数据
   */
  public enableDebug(): void {
    this.debugMode = true;
  }

  /**
   * 禁用调试模式
   */
  public disableDebug(): void {
    this.debugMode = false;
  }

  /**
   * 记录调试步骤
   * @param title - 步骤标题
   * @param description - 步骤描述
   * @param data - 这一步产生的数据
   */
  private logStep(title: string, description: string, data: unknown): void {
    // 如果没有启用调试模式，直接返回
    if (!this.debugMode) return;
    
    // 获取当前时间戳
    const now = performance.now();
    
    // 获取上一步骤，计算其耗时
    const lastStep = this.debugSteps[this.debugSteps.length - 1];
    if (lastStep) {
      // 上一步的耗时 = 当前时间 - 上一步的开始时间
      lastStep.duration = now - lastStep.timestamp;
    }
    
    // 添加新步骤到数组
    this.debugSteps.push({
      stepNumber: this.debugSteps.length + 1,  // 步骤序号从1开始
      title,
      description,
      timestamp: now,  // 记录开始时间
      data,
    });
  }

  /**
   * 分析两个代码文件的差异
   * 这是主入口方法，执行完整的差异分析流程
   * 
   * @param oldCode - 旧版本代码字符串
   * @param newCode - 新版本代码字符串
   * @returns DiffResult - 包含所有分析结果的对象
   */
  public analyzeDiff(oldCode: string, newCode: string): DiffResult {
    // ===== 初始化 =====
    // 重置调试信息（每次分析都是独立的）
    this.debugSteps = [];
    this.debugStartTime = performance.now();
    
    // 初始化调试数据容器
    let debugInfo: DebugInfo | undefined;
    let oldASTNodes: ASTNodeInfo[] = [];  // 旧代码的AST节点列表
    let newASTNodes: ASTNodeInfo[] = [];  // 新代码的AST节点列表
    let lcsMatchPairs: LCSMatchPair[] = []; // LCS匹配结果

    // 记录第一步：开始分析
    this.logStep('开始分析', '初始化差异分析器', {
      oldCodeLength: oldCode.length,           // 旧代码字符数
      newCodeLength: newCode.length,           // 新代码字符数
      oldCodeLines: oldCode.split('\n').length, // 旧代码行数
      newCodeLines: newCode.split('\n').length, // 新代码行数
    });

    // ===== 步骤1: 文本层面的 diff =====
    // 使用 diff 库的 diffLines 函数进行逐行文本比较
    const lineChanges = diffLines(oldCode, newCode);
    
    // 记录文本差异分析结果
    this.logStep('文本差异分析', '使用 diffLines 算法计算行级差异', {
      changeCount: lineChanges.length,  // 变化块的数量
      // 将每个变化块转换为简洁的描述
      changes: lineChanges.map(c => ({
        type: c.added ? 'added' : c.removed ? 'removed' : 'unchanged',
        lines: c.count,
        preview: c.value.substring(0, 100) + (c.value.length > 100 ? '...' : ''),
      })),
    });

    // ===== 步骤2: AST 结构层面的 diff =====
    // 这是核心部分：通过AST比较代码的结构
    let astStructureSimilarity = 0;
    let astStructureChanges: ASTStructureChange[] = [];
    
    try {
      // 步骤2.1: 解析旧代码生成AST
      this.logStep('解析旧代码 AST', '使用 @babel/parser 解析旧代码', { status: 'parsing' });
      const oldAst = parse(oldCode, this.parserOptions);  // 调用Babel解析器
      this.logStep('解析旧代码 AST 完成', 'AST 解析成功', {
        programType: oldAst.type,              // 根节点类型（应该是 File）
        bodyLength: oldAst.program.body.length, // 顶层语句数量
      });

      // 步骤2.2: 解析新代码生成AST
      this.logStep('解析新代码 AST', '使用 @babel/parser 解析新代码', { status: 'parsing' });
      const newAst = parse(newCode, this.parserOptions);
      this.logStep('解析新代码 AST 完成', 'AST 解析成功', {
        programType: newAst.type,
        bodyLength: newAst.program.body.length,
      });

      // 步骤2.3: 收集旧代码的节点类型序列
      this.logStep('收集旧代码节点类型', '前序遍历收集所有 AST 节点类型', { status: 'collecting' });
      const oldTypes = this.collectASTNodeTypes(oldAst);    // 只收集类型名
      oldASTNodes = this.collectASTNodeInfos(oldAst);       // 收集详细信息（用于可视化）
      this.logStep('收集旧代码节点类型完成', `共收集 ${oldTypes.length} 个节点`, {
        nodeCount: oldTypes.length,
        uniqueTypes: [...new Set(oldTypes)],                 // 去重后的类型列表
        typeDistribution: this.getTypeDistribution(oldTypes), // 类型分布统计
      });

      // 步骤2.4: 收集新代码的节点类型序列
      this.logStep('收集新代码节点类型', '前序遍历收集所有 AST 节点类型', { status: 'collecting' });
      const newTypes = this.collectASTNodeTypes(newAst);
      newASTNodes = this.collectASTNodeInfos(newAst);
      this.logStep('收集新代码节点类型完成', `共收集 ${newTypes.length} 个节点`, {
        nodeCount: newTypes.length,
        uniqueTypes: [...new Set(newTypes)],
        typeDistribution: this.getTypeDistribution(newTypes),
      });

      // 步骤2.5: 收集结构签名（忽略顺序、变量名、样式值）
      this.logStep('收集旧代码结构签名', '提取影响功能的核心结构', { status: 'collecting' });
      const oldSignatures = this.collectStructuralSignatures(oldAst);
      this.logStep('旧代码结构签名完成', `共收集 ${oldSignatures.size} 种结构签名`, {
        signatures: Object.fromEntries(oldSignatures),
      });

      this.logStep('收集新代码结构签名', '提取影响功能的核心结构', { status: 'collecting' });
      const newSignatures = this.collectStructuralSignatures(newAst);
      this.logStep('新代码结构签名完成', `共收集 ${newSignatures.size} 种结构签名`, {
        signatures: Object.fromEntries(newSignatures),
      });

      // 步骤2.6: 比较结构签名（忽略顺序）
      this.logStep('结构签名比较', '使用多重集比较，忽略顺序差异', { status: 'comparing' });
      const structuralResult = this.compareStructuralSignatures(oldSignatures, newSignatures);
      astStructureSimilarity = structuralResult.similarity;
      astStructureChanges = structuralResult.changes;

      // 步骤2.7: 同时保留 LCS 用于可视化（可选）
      const { matchPairs } = this.compareASTStructureWithDebug(oldTypes, newTypes);
      lcsMatchPairs = matchPairs;

      // 标记哪些节点被匹配上了（用于可视化）
      matchPairs.forEach(pair => {
        if (oldASTNodes[pair.oldIndex]) oldASTNodes[pair.oldIndex].matched = true;
        if (newASTNodes[pair.newIndex]) newASTNodes[pair.newIndex].matched = true;
      });

      this.logStep('结构比较完成', `结构相似度: ${astStructureSimilarity}%`, {
        similarity: astStructureSimilarity,
        changesCount: astStructureChanges.length,
        changes: astStructureChanges,
      });
    } catch (error) {
      // 如果代码语法有错误，Babel解析会失败，这里捕获异常
      this.logStep('AST 解析失败', '代码解析出错，跳过 AST 结构分析', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // ===== 步骤3: AST 语义层面的 diff =====
    // 提取并比较代码中的导入、函数、类、变量
    this.logStep('语义结构提取', '提取代码中的导入、函数、类、变量等结构', { status: 'extracting' });
    const astChanges = this.compareAST(oldCode, newCode);
    this.logStep('语义差异分析完成', `发现 ${astChanges.length} 个语义变化`, {
      changes: astChanges,
      byCategory: this.groupChangesByCategory(astChanges), // 按类别分组统计
    });

    // ===== 步骤4: 计算行级统计信息 =====
    this.logStep('统计计算', '计算行级统计信息', { status: 'calculating' });
    const statistics = this.calculateStatistics(lineChanges);
    this.logStep('统计计算完成', '行级统计信息', statistics);

    // ===== 步骤5: 计算基于语义结构的相似度 =====
    this.logStep('相似度计算', '计算基于语义结构的相似度', { status: 'calculating' });
    const semanticSimilarity = this.calculateSemanticSimilarity(oldCode, newCode);
    this.logStep('相似度计算完成', `语义相似度: ${semanticSimilarity}%`, {
      semanticSimilarity,
      astStructureSimilarity,
    });

    // ===== 收尾工作 =====
    // 记录最后一步的耗时
    const endTime = performance.now();
    if (this.debugSteps.length > 0) {
      this.debugSteps[this.debugSteps.length - 1].duration = endTime - this.debugSteps[this.debugSteps.length - 1].timestamp;
    }

    this.logStep('分析完成', '所有分析步骤已完成', {
      totalSteps: this.debugSteps.length,
      totalDuration: endTime - this.debugStartTime,
    });

    // 如果启用了调试模式，构建调试信息对象
    if (this.debugMode) {
      debugInfo = {
        steps: [...this.debugSteps],              // 复制步骤数组
        totalDuration: endTime - this.debugStartTime, // 总耗时
        oldASTNodes,                               // 旧代码节点列表
        newASTNodes,                               // 新代码节点列表
        lcsMatchPairs,                             // LCS匹配对列表
      };
    }

    // 返回完整的分析结果
    return {
      lineChanges,           // 文本行级差异
      astChanges,            // 语义级差异
      statistics,            // 行级统计
      semanticSimilarity,    // 语义相似度
      astStructureSimilarity, // AST结构相似度（核心指标）
      astStructureChanges,   // 节点级差异
      debugInfo,             // 调试信息
    };
  }

  /**
   * 获取节点类型分布
   * 统计每种节点类型出现的次数
   * 
   * @param types - 节点类型数组
   * @returns Record<string, number> - 类型到数量的映射
   */
  private getTypeDistribution(types: string[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const t of types) {
      dist[t] = (dist[t] || 0) + 1;  // 累加计数
    }
    return dist;
  }

  /**
   * 按类别分组统计变化
   * 
   * @param changes - 变化详情数组
   * @returns Record<string, number> - 类别到数量的映射
   */
  private groupChangesByCategory(changes: ASTChangeDetail[]): Record<string, number> {
    const grouped: Record<string, number> = {};
    for (const c of changes) {
      grouped[c.category] = (grouped[c.category] || 0) + 1;
    }
    return grouped;
  }

  /**
   * 收集 AST 节点详细信息
   * 用于在调试面板中可视化展示AST树
   * 只收集结构相关的节点（忽略不影响功能的节点）
   * 
   * @param ast - Babel 解析生成的 AST
   * @param structuralOnly - 是否只收集结构节点（默认true）
   * @returns ASTNodeInfo[] - 节点信息数组（按前序遍历顺序）
   */
  private collectASTNodeInfos(ast: t.File, structuralOnly: boolean = false): ASTNodeInfo[] {
    const nodes: ASTNodeInfo[] = [];
    let index = 0;              // 节点索引计数器
    const pathStack: string[] = []; // 路径栈，用于记录当前节点的祖先路径

    // 使用 Babel traverse 遍历 AST
    traverse(ast, {
      // 进入节点时的回调
      enter(path) {
        const nodeType = path.node.type;
        const depth = pathStack.length;  // 当前深度 = 栈的长度
        
        // 如果只收集结构节点，跳过非结构节点
        if (structuralOnly && !STRUCTURAL_NODE_TYPES.has(nodeType)) {
          pathStack.push(nodeType);
          return;
        }
        
        // 构建节点路径字符串
        const nodePath = pathStack.join(' > ') + (pathStack.length ? ' > ' : '') + nodeType;
        
        // 记录节点信息
        nodes.push({
          index: index++,         // 分配索引并自增
          type: nodeType,         // 节点类型
          depth,                  // 深度
          path: nodePath,         // 路径
          matched: false,         // 默认未匹配（后续会更新）
        });
        
        // 将当前节点类型压入路径栈
        pathStack.push(nodeType);
      },
      // 退出节点时的回调
      exit() {
        pathStack.pop();  // 弹出路径栈
      },
    });

    return nodes;
  }

  /**
   * 带调试信息的 AST 结构比较
   * 使用LCS算法比较两个节点类型序列，计算相似度
   * 
   * @param oldTypes - 旧代码的节点类型序列
   * @param newTypes - 新代码的节点类型序列
   * @returns 包含相似度、差异列表、匹配对的对象
   */
  private compareASTStructureWithDebug(
    oldTypes: string[],
    newTypes: string[]
  ): { similarity: number; changes: ASTStructureChange[]; matchPairs: LCSMatchPair[] } {
    
    // 调用LCS算法，获取匹配的索引对
    const { oldIndices, newIndices } = this.longestCommonSubsequenceIndices(oldTypes, newTypes);
    
    // 计算相似度：使用 Dice 系数公式
    // similarity = (匹配数 × 2) / (旧序列长度 + 新序列长度) × 100%
    const total = oldTypes.length + newTypes.length;
    const similarity = total === 0 ? 100 : Math.round((200 * oldIndices.length) / total * 100) / 100;

    // 将匹配的索引转换为 Set，方便快速查找
    const oldMatched = new Set(oldIndices);
    const newMatched = new Set(newIndices);

    // 生成匹配对数组（用于可视化）
    const matchPairs: LCSMatchPair[] = oldIndices.map((oldIdx, i) => ({
      oldIndex: oldIdx,           // 旧序列中的索引
      newIndex: newIndices[i],    // 新序列中的索引
      nodeType: oldTypes[oldIdx], // 匹配的节点类型
    }));

    // 统计未匹配的节点（差异）
    const changes: ASTStructureChange[] = [];
    const removedByType = new Map<string, number>();  // 被移除的节点类型统计
    const addedByType = new Map<string, number>();    // 被新增的节点类型统计

    // 统计旧代码中未匹配的节点（被移除）
    for (let i = 0; i < oldTypes.length; i++) {
      if (!oldMatched.has(i)) {
        const t = oldTypes[i];
        removedByType.set(t, (removedByType.get(t) ?? 0) + 1);
      }
    }
    
    // 统计新代码中未匹配的节点（被新增）
    for (let i = 0; i < newTypes.length; i++) {
      if (!newMatched.has(i)) {
        const t = newTypes[i];
        addedByType.set(t, (addedByType.get(t) ?? 0) + 1);
      }
    }

    // 将统计结果转换为差异描述
    removedByType.forEach((count, nodeType) => {
      changes.push({
        type: 'removed',
        nodeType,
        path: '',
        description: `移除 ${count} 个 ${nodeType} 节点`,
      });
    });
    addedByType.forEach((count, nodeType) => {
      changes.push({
        type: 'added',
        nodeType,
        path: '',
        description: `新增 ${count} 个 ${nodeType} 节点`,
      });
    });

    return { similarity, changes, matchPairs };
  }

  /**
   * 前序遍历收集 AST 节点类型序列
   * 这是LCS算法的输入数据
   * 
   * @param ast - Babel 解析生成的 AST
   * @returns string[] - 节点类型名称数组（按前序遍历顺序）
   */
  private collectASTNodeTypes(ast: t.File): string[] {
    const types: string[] = [];
    
    // 使用 Babel traverse 进行前序遍历
    traverse(ast, {
      enter(path) {
        // 进入每个节点时，收集其类型名
        types.push(path.node.type);
      },
    });
    
    return types;
  }

  /**
   * 收集结构签名（忽略顺序、变量名、样式值等）
   * 只收集影响功能的核心结构信息
   * 
   * @param ast - Babel 解析生成的 AST
   * @returns Map<string, number> - 结构签名到出现次数的映射（多重集）
   */
  private collectStructuralSignatures(ast: t.File): Map<string, number> {
    const signatures = new Map<string, number>();
    
    traverse(ast, {
      enter: (path) => {
        const nodeType = path.node.type;
        
        // 只收集核心结构节点
        if (!STRUCTURAL_NODE_TYPES.has(nodeType)) {
          return;
        }
        
        // 生成结构签名
        const signature = this.generateNodeSignature(path.node);
        if (signature) {
          signatures.set(signature, (signatures.get(signature) || 0) + 1);
        }
      },
    });
    
    return signatures;
  }

  /**
   * 为单个节点生成结构签名
   * 只包含结构信息，忽略具体值和名称
   * 
   * 关键优化：将功能等价的不同语法结构统一为相同签名
   * - function foo() {} 和 const foo = () => {} → 统一为 Function
   * - if-else 和 三元运算符 → 统一为 Conditional
   * - for/while 和 forEach/map → 统一为 Loop
   * 
   * @param node - AST 节点
   * @returns string - 结构签名
   */
  private generateNodeSignature(node: t.Node): string {
    const nodeType = node.type;
    
    switch (nodeType) {
      // ===== 函数相关：统一为 Function 签名 =====
      // function foo() {}, const foo = function() {}, const foo = () => {}
      // 这三种写法功能等价，统一为 Function
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const funcNode = node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
        const isAsync = funcNode.async ? 'async' : 'sync';
        const isGenerator = funcNode.generator ? 'gen' : 'normal';
        const paramCount = funcNode.params.length;
        // 统一使用 Function 作为签名前缀
        return `Function:${isAsync}:${isGenerator}:params=${paramCount}`;
      }
      
      // 类方法和对象方法：统一为 Method
      case 'ClassMethod':
      case 'ObjectMethod': {
        const methodNode = node as t.ClassMethod | t.ObjectMethod;
        const kind = methodNode.kind || 'method';
        const isAsync = methodNode.async ? 'async' : 'sync';
        const paramCount = methodNode.params.length;
        return `Method:${kind}:${isAsync}:params=${paramCount}`;
      }
      
      // JSX 元素：记录标签名（组件类型很重要）
      case 'JSXElement': {
        const jsxNode = node as t.JSXElement;
        const tagName = this.getJSXTagName(jsxNode.openingElement);
        // 收集非样式属性的数量
        const structuralAttrCount = this.countStructuralJSXAttributes(jsxNode.openingElement);
        return `JSXElement:${tagName}:attrs=${structuralAttrCount}`;
      }
      
      case 'JSXOpeningElement': {
        const openingNode = node as t.JSXOpeningElement;
        const tagName = this.getJSXTagName(openingNode);
        return `JSXOpeningElement:${tagName}`;
      }
      
      // ===== 条件语句：统一为 Conditional 签名 =====
      // if-else 和 三元运算符 功能等价
      case 'IfStatement':
      case 'ConditionalExpression':
        return 'Conditional';
      
      // Switch 单独处理（语义上与 if-else 不完全等价）
      case 'SwitchStatement':
        return 'Switch';
      
      // Switch case：记录是否是默认分支
      case 'SwitchCase': {
        const caseNode = node as t.SwitchCase;
        return caseNode.test ? 'SwitchCase:case' : 'SwitchCase:default';
      }
      
      // ===== 循环语句：统一为 Loop 签名 =====
      // for, for-in, for-of, while, do-while 功能等价
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        return 'Loop';
      
      // ===== 类相关：统一为 Class 签名 =====
      // class Foo {} 和 const Foo = class {} 功能等价
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const classNode = node as t.ClassDeclaration | t.ClassExpression;
        const hasSuper = classNode.superClass ? 'extends' : 'noextends';
        return `Class:${hasSuper}`;
      }
      
      // 导入导出：记录来源模块
      case 'ImportDeclaration': {
        const importNode = node as t.ImportDeclaration;
        const source = importNode.source.value;
        const specifierCount = importNode.specifiers.length;
        return `ImportDeclaration:${source}:specifiers=${specifierCount}`;
      }
      
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        return nodeType;
      
      // ===== 调用表达式：识别循环等价的数组方法 =====
      case 'CallExpression':
      case 'NewExpression': {
        const callNode = node as t.CallExpression | t.NewExpression;
        const argCount = callNode.arguments.length;
        const calleeName = this.getCalleeName(callNode.callee);
        
        // 数组迭代方法视为循环的等价形式
        const loopEquivalentMethods = new Set([
          'forEach', 'map', 'filter', 'reduce', 'reduceRight',
          'find', 'findIndex', 'some', 'every', 'flatMap'
        ]);
        
        if (loopEquivalentMethods.has(calleeName)) {
          // 将 arr.forEach() 等视为 Loop
          return 'Loop';
        }
        
        return `${nodeType}:${calleeName}:args=${argCount}`;
      }
      
      // 其他结构节点：只记录类型
      default:
        return nodeType;
    }
  }

  /**
   * 获取 JSX 标签名
   */
  private getJSXTagName(opening: t.JSXOpeningElement): string {
    if (t.isJSXIdentifier(opening.name)) {
      return opening.name.name;
    } else if (t.isJSXMemberExpression(opening.name)) {
      // 如 <Component.Sub />
      return this.getJSXMemberExpressionName(opening.name);
    } else if (t.isJSXNamespacedName(opening.name)) {
      return `${opening.name.namespace.name}:${opening.name.name.name}`;
    }
    return 'unknown';
  }

  /**
   * 获取 JSX 成员表达式名称
   */
  private getJSXMemberExpressionName(expr: t.JSXMemberExpression): string {
    const property = expr.property.name;
    if (t.isJSXIdentifier(expr.object)) {
      return `${expr.object.name}.${property}`;
    } else if (t.isJSXMemberExpression(expr.object)) {
      return `${this.getJSXMemberExpressionName(expr.object)}.${property}`;
    }
    return property;
  }

  /**
   * 统计 JSX 元素中非样式属性的数量
   */
  private countStructuralJSXAttributes(opening: t.JSXOpeningElement): number {
    let count = 0;
    for (const attr of opening.attributes) {
      if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
        const attrName = attr.name.name;
        // 忽略样式相关属性
        if (!IGNORED_JSX_ATTRIBUTES.has(attrName)) {
          count++;
        }
      } else if (t.isJSXSpreadAttribute(attr)) {
        // spread 属性算作结构属性
        count++;
      }
    }
    return count;
  }

  /**
   * 获取调用表达式的被调用者名称
   */
  private getCalleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string {
    if (t.isIdentifier(callee)) {
      return callee.name;
    } else if (t.isMemberExpression(callee)) {
      // 如 obj.method()
      if (t.isIdentifier(callee.property)) {
        return callee.property.name;
      }
    }
    return 'call';
  }

  /**
   * 比较两个结构签名集合，计算结构相似度
   * 使用多重集比较，忽略顺序
   * 
   * @param oldSignatures - 旧代码的结构签名
   * @param newSignatures - 新代码的结构签名
   * @returns 相似度和差异信息
   */
  private compareStructuralSignatures(
    oldSignatures: Map<string, number>,
    newSignatures: Map<string, number>
  ): { similarity: number; changes: ASTStructureChange[] } {
    const changes: ASTStructureChange[] = [];
    
    // 收集所有唯一签名
    const allSignatures = new Set([...oldSignatures.keys(), ...newSignatures.keys()]);
    
    let matchedCount = 0;
    let totalCount = 0;
    
    for (const sig of allSignatures) {
      const oldCount = oldSignatures.get(sig) || 0;
      const newCount = newSignatures.get(sig) || 0;
      
      // 匹配数量取较小值
      const matched = Math.min(oldCount, newCount);
      matchedCount += matched;
      totalCount += Math.max(oldCount, newCount);
      
      // 记录差异
      if (oldCount > newCount) {
        const diff = oldCount - newCount;
        changes.push({
          type: 'removed',
          nodeType: this.extractNodeTypeFromSignature(sig),
          path: '',
          description: `移除 ${diff} 个 ${this.formatSignatureDescription(sig)}`,
        });
      } else if (newCount > oldCount) {
        const diff = newCount - oldCount;
        changes.push({
          type: 'added',
          nodeType: this.extractNodeTypeFromSignature(sig),
          path: '',
          description: `新增 ${diff} 个 ${this.formatSignatureDescription(sig)}`,
        });
      }
    }
    
    // 计算相似度
    const similarity = totalCount === 0 ? 100 : Math.round((matchedCount / totalCount) * 10000) / 100;
    
    return { similarity, changes };
  }

  /**
   * 从签名中提取节点类型
   */
  private extractNodeTypeFromSignature(signature: string): string {
    return signature.split(':')[0];
  }

  /**
   * 格式化签名描述，使其更易读
   */
  private formatSignatureDescription(signature: string): string {
    const parts = signature.split(':');
    const nodeType = parts[0];
    
    switch (nodeType) {
      // 统一的函数签名
      case 'Function': {
        const isAsync = parts[1];
        const paramCount = parts[3]?.replace('params=', '') || '0';
        return `${isAsync === 'async' ? '异步' : ''}函数 (${paramCount}个参数)`;
      }
      
      // 统一的方法签名
      case 'Method': {
        const kind = parts[1];
        const isAsync = parts[2];
        const paramCount = parts[3]?.replace('params=', '') || '0';
        const kindText = kind === 'get' ? 'getter' : kind === 'set' ? 'setter' : '方法';
        return `${isAsync === 'async' ? '异步' : ''}${kindText} (${paramCount}个参数)`;
      }
      
      // 统一的条件签名
      case 'Conditional':
        return '条件语句 (if/三元表达式)';
      
      // Switch 语句
      case 'Switch':
        return 'switch 语句';
      
      // 统一的循环签名
      case 'Loop':
        return '循环 (for/while/forEach/map等)';
      
      // 统一的类签名
      case 'Class': {
        const hasSuper = parts[1] === 'extends';
        return `类${hasSuper ? ' (有继承)' : ''}`;
      }
      
      case 'JSXElement': {
        const tagName = parts[1];
        return `<${tagName}> 组件`;
      }
      
      case 'ImportDeclaration': {
        const source = parts[1];
        return `导入 '${source}'`;
      }
      
      case 'CallExpression': {
        const calleeName = parts[1];
        const argCount = parts[2]?.replace('args=', '') || '0';
        return `${calleeName}() 调用 (${argCount}个参数)`;
      }
      
      case 'NewExpression': {
        const calleeName = parts[1];
        const argCount = parts[2]?.replace('args=', '') || '0';
        return `new ${calleeName}() 实例化 (${argCount}个参数)`;
      }
      
      // 兼容旧签名格式
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const isAsync = parts[1];
        const paramCount = parts[3]?.replace('params=', '') || '0';
        return `${isAsync === 'async' ? '异步' : ''}函数 (${paramCount}个参数)`;
      }
      
      case 'IfStatement':
        return 'if 条件语句';
      
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
        return `${nodeType} 循环`;
      
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const hasSuper = parts[1] === 'extends';
        return `类${hasSuper ? ' (有继承)' : ''}`;
      }
      
      default:
        return signature;
    }
  }

  /**
   * LCS（最长公共子序列）算法实现
   * 使用动态规划找出两个序列的最长公共子序列
   * 并返回匹配的索引对
   * 
   * 算法复杂度：O(m × n)，其中 m 和 n 分别是两个序列的长度
   * 
   * @param a - 第一个序列（旧代码节点类型）
   * @param b - 第二个序列（新代码节点类型）
   * @returns 包含两个索引数组的对象，表示匹配的位置
   */
  private longestCommonSubsequenceIndices(
    a: string[],
    b: string[]
  ): { oldIndices: number[]; newIndices: number[] } {
    const m = a.length;  // 序列a的长度
    const n = b.length;  // 序列b的长度
    
    // 创建DP表，dp[i][j] 表示 a[0..i-1] 和 b[0..j-1] 的LCS长度
    const dp: number[][] = Array(m + 1)
      .fill(0)
      .map(() => Array(n + 1).fill(0));
    
    // 填充DP表
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          // 如果当前元素相等，LCS长度 = 左上角 + 1
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          // 否则，取左边或上边的较大值
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    // 回溯找出匹配的索引对
    const oldIndices: number[] = [];  // 旧序列中匹配的索引
    const newIndices: number[] = [];  // 新序列中匹配的索引
    let i = m;
    let j = n;
    
    // 从右下角开始回溯
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        // 元素相等，说明是LCS的一部分，记录索引
        oldIndices.unshift(i - 1);  // 添加到数组开头
        newIndices.unshift(j - 1);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        // 左边较大，向左移动
        i--;
      } else {
        // 上边较大，向上移动
        j--;
      }
    }
    
    return { oldIndices, newIndices };
  }

  /**
   * AST级别的语义比较
   * 比较两份代码中的导入、函数、类、变量
   * 
   * @param oldCode - 旧代码字符串
   * @param newCode - 新代码字符串
   * @returns ASTChangeDetail[] - 变化详情数组
   */
  private compareAST(oldCode: string, newCode: string): ASTChangeDetail[] {
    const changes: ASTChangeDetail[] = [];

    try {
      // 解析两份代码
      const oldAst = parse(oldCode, this.parserOptions);
      const newAst = parse(newCode, this.parserOptions);

      // 提取代码结构
      const oldStructure = this.extractStructure(oldAst);
      const newStructure = this.extractStructure(newAst);

      // 比较各个部分，收集差异
      changes.push(...this.compareImports(oldStructure.imports, newStructure.imports));
      changes.push(...this.compareFunctions(oldStructure.functions, newStructure.functions));
      changes.push(...this.compareClasses(oldStructure.classes, newStructure.classes));
      changes.push(...this.compareVariables(oldStructure.variables, newStructure.variables));
    } catch (error) {
      // 解析失败时打印错误
      console.error('AST解析错误:', error);
    }

    return changes;
  }

  /**
   * 从AST中提取代码结构
   * 遍历AST，收集导入、函数、类、变量、JSX组件的信息
   * 
   * @param ast - Babel 解析生成的 AST
   * @returns CodeStructure - 代码结构对象
   */
  private extractStructure(ast: t.File): CodeStructure {
    // 初始化结构对象
    const structure: CodeStructure = {
      imports: [],
      functions: [],
      classes: [],
      variables: [],
      jsx: [],
    };

    // 遍历AST，根据节点类型收集信息
    traverse(ast, {
      // 处理导入声明：import xxx from 'yyy'
      ImportDeclaration(path) {
        // 收集导入的模块名
        structure.imports.push(path.node.source.value);
      },

      // 处理函数声明：function foo() {}
      FunctionDeclaration(path) {
        if (path.node.id) {
          structure.functions.push({
            name: path.node.id.name,                  // 函数名
            line: path.node.loc?.start.line || 0,    // 起始行号
          });
        }
      },

      // 处理变量声明器：const foo = xxx
      VariableDeclarator(path) {
        // 检查是否是箭头函数或函数表达式
        if (
          t.isIdentifier(path.node.id) &&
          (t.isArrowFunctionExpression(path.node.init) ||
            t.isFunctionExpression(path.node.init))
        ) {
          // 如果是函数，添加到函数列表
          structure.functions.push({
            name: path.node.id.name,
            line: path.node.loc?.start.line || 0,
          });
        } else if (t.isIdentifier(path.node.id)) {
          // 否则添加到变量列表
          structure.variables.push({
            name: path.node.id.name,
            line: path.node.loc?.start.line || 0,
          });
        }
      },

      // 处理类声明：class Foo {}
      ClassDeclaration(path) {
        const className = path.node.id?.name || 'anonymous';
        const methods: string[] = [];
        const properties: string[] = [];

        // 遍历类的成员
        path.node.body.body.forEach((member) => {
          // 收集方法名
          if (t.isClassMethod(member) && t.isIdentifier(member.key)) {
            methods.push(member.key.name);
          }
          // 收集属性名
          else if (t.isClassProperty(member) && t.isIdentifier(member.key)) {
            properties.push(member.key.name);
          }
        });

        structure.classes.push({
          name: className,
          methods,
          properties,
          line: path.node.loc?.start.line || 0,
        });
      },

      // 处理JSX元素：<Component />
      JSXElement(path) {
        if (t.isJSXIdentifier(path.node.openingElement.name)) {
          structure.jsx.push({
            component: path.node.openingElement.name.name,  // 组件名
            line: path.node.loc?.start.line || 0,
          });
        }
      },
    });

    return structure;
  }

  /**
   * 比较导入语句的差异
   * 
   * @param oldImports - 旧代码的导入列表
   * @param newImports - 新代码的导入列表
   * @returns ASTChangeDetail[] - 变化详情数组
   */
  private compareImports(oldImports: string[], newImports: string[]): ASTChangeDetail[] {
    const changes: ASTChangeDetail[] = [];
    
    // 转换为Set便于查找
    const oldSet = new Set(oldImports);
    const newSet = new Set(newImports);

    // 查找被移除的导入
    for (const imp of oldImports) {
      if (!newSet.has(imp)) {
        changes.push({
          type: 'removed',
          category: 'import',
          description: `移除导入: ${imp}`,
          severity: 'low',  // 导入变化通常影响较小
        });
      }
    }

    // 查找新增的导入
    for (const imp of newImports) {
      if (!oldSet.has(imp)) {
        changes.push({
          type: 'added',
          category: 'import',
          description: `新增导入: ${imp}`,
          severity: 'low',
        });
      }
    }

    return changes;
  }

  /**
   * 比较函数的差异
   * 
   * @param oldFuncs - 旧代码的函数列表
   * @param newFuncs - 新代码的函数列表
   * @returns ASTChangeDetail[] - 变化详情数组
   */
  private compareFunctions(
    oldFuncs: FunctionInfo[],
    newFuncs: FunctionInfo[]
  ): ASTChangeDetail[] {
    const changes: ASTChangeDetail[] = [];
    
    // 转换为Map，以函数名为键
    const oldMap = new Map(oldFuncs.map((f) => [f.name, f]));
    const newMap = new Map(newFuncs.map((f) => [f.name, f]));

    // 查找被移除的函数
    for (const [name, func] of oldMap) {
      if (!newMap.has(name)) {
        changes.push({
          type: 'removed',
          category: 'function',
          description: `移除函数: ${name}`,
          lineNumber: func.line,
          severity: 'high',  // 函数变化影响较大
        });
      }
    }

    // 查找新增的函数
    for (const [name, func] of newMap) {
      if (!oldMap.has(name)) {
        changes.push({
          type: 'added',
          category: 'function',
          description: `新增函数: ${name}`,
          lineNumber: func.line,
          severity: 'high',
        });
      }
    }

    return changes;
  }

  /**
   * 比较类的差异
   * 包括类本身的增删，以及类方法的增删
   * 
   * @param oldClasses - 旧代码的类列表
   * @param newClasses - 新代码的类列表
   * @returns ASTChangeDetail[] - 变化详情数组
   */
  private compareClasses(oldClasses: ClassInfo[], newClasses: ClassInfo[]): ASTChangeDetail[] {
    const changes: ASTChangeDetail[] = [];
    
    // 转换为Map，以类名为键
    const oldMap = new Map(oldClasses.map((c) => [c.name, c]));
    const newMap = new Map(newClasses.map((c) => [c.name, c]));

    // 查找被移除的类
    for (const [name, cls] of oldMap) {
      if (!newMap.has(name)) {
        changes.push({
          type: 'removed',
          category: 'class',
          description: `移除类: ${name}`,
          lineNumber: cls.line,
          severity: 'high',
        });
      }
    }

    // 查找新增的类，以及现有类的方法变化
    for (const [name, cls] of newMap) {
      if (!oldMap.has(name)) {
        // 新增的类
        changes.push({
          type: 'added',
          category: 'class',
          description: `新增类: ${name}`,
          lineNumber: cls.line,
          severity: 'high',
        });
      } else {
        // 类已存在，比较方法变化
        const oldCls = oldMap.get(name)!;
        const oldMethods = new Set(oldCls.methods);
        const newMethods = new Set(cls.methods);

        // 查找被移除的方法
        for (const method of oldCls.methods) {
          if (!newMethods.has(method)) {
            changes.push({
              type: 'removed',
              category: 'class',
              description: `类 ${name} 移除方法: ${method}`,
              lineNumber: cls.line,
              severity: 'medium',  // 方法变化影响中等
            });
          }
        }

        // 查找新增的方法
        for (const method of cls.methods) {
          if (!oldMethods.has(method)) {
            changes.push({
              type: 'added',
              category: 'class',
              description: `类 ${name} 新增方法: ${method}`,
              lineNumber: cls.line,
              severity: 'medium',
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * 比较变量的差异
   * 只关注"重要"的变量（常量、配置、选项）
   * 
   * @param oldVars - 旧代码的变量列表
   * @param newVars - 新代码的变量列表
   * @returns ASTChangeDetail[] - 变化详情数组
   */
  private compareVariables(
    oldVars: VariableInfo[],
    newVars: VariableInfo[]
  ): ASTChangeDetail[] {
    const changes: ASTChangeDetail[] = [];
    
    // 转换为Set，以变量名为键
    const oldSet = new Set(oldVars.map((v) => v.name));
    const newSet = new Set(newVars.map((v) => v.name));

    // 定义"重要变量"的模式：
    // - 全大写（如 API_URL）
    // - 以 Config 结尾（如 serverConfig）
    // - 以 Options 结尾（如 requestOptions）
    const importantVarPattern =
      /^[A-Z_][A-Z0-9_]*$|^[a-z][a-zA-Z0-9]*Config$|^[a-z][a-zA-Z0-9]*Options$/;

    // 查找被移除的重要变量
    for (const v of oldVars) {
      if (!newSet.has(v.name) && importantVarPattern.test(v.name)) {
        changes.push({
          type: 'removed',
          category: 'variable',
          description: `移除变量: ${v.name}`,
          lineNumber: v.line,
          severity: 'low',
        });
      }
    }

    // 查找新增的重要变量
    for (const v of newVars) {
      if (!oldSet.has(v.name) && importantVarPattern.test(v.name)) {
        changes.push({
          type: 'added',
          category: 'variable',
          description: `新增变量: ${v.name}`,
          lineNumber: v.line,
          severity: 'low',
        });
      }
    }

    return changes;
  }

  /**
   * 计算行级统计信息
   * 
   * @param changes - diff库返回的变化数组
   * @returns DiffStatistics - 统计信息对象
   */
  private calculateStatistics(changes: Change[]): DiffStatistics {
    let totalLines = 0;    // 总行数
    let addedLines = 0;    // 新增行数
    let removedLines = 0;  // 删除行数

    // 遍历每个变化块
    for (const change of changes) {
      const lineCount = change.count || 0;

      if (change.added) {
        // 新增的行
        addedLines += lineCount;
        totalLines += lineCount;
      } else if (change.removed) {
        // 删除的行
        removedLines += lineCount;
        totalLines += lineCount;
      } else {
        // 未变化的行
        totalLines += lineCount;
      }
    }

    // 修改行数 = 新增 + 删除
    const modifiedLines = addedLines + removedLines;
    // 未变化行数
    const unchangedLines = totalLines - modifiedLines;
    // 相似度 = 未变化行数 / 总行数
    const similarity = totalLines > 0 ? (unchangedLines / totalLines) * 100 : 100;

    return {
      totalLines,
      addedLines,
      removedLines,
      modifiedLines,
      similarity: Math.round(similarity * 100) / 100,  // 保留两位小数
    };
  }

  /**
   * 计算语义相似度
   * 基于导入、函数、类的相似度加权计算
   * 
   * @param oldCode - 旧代码字符串
   * @param newCode - 新代码字符串
   * @returns number - 相似度百分比 0-100
   */
  private calculateSemanticSimilarity(oldCode: string, newCode: string): number {
    try {
      // 解析两份代码
      const oldAst = parse(oldCode, this.parserOptions);
      const newAst = parse(newCode, this.parserOptions);

      // 提取代码结构
      const oldStructure = this.extractStructure(oldAst);
      const newStructure = this.extractStructure(newAst);

      // 分别计算导入、函数、类的集合相似度
      const importSim = this.calculateSetSimilarity(
        oldStructure.imports,
        newStructure.imports
      );
      const funcSim = this.calculateSetSimilarity(
        oldStructure.functions.map((f) => f.name),
        newStructure.functions.map((f) => f.name)
      );
      const classSim = this.calculateSetSimilarity(
        oldStructure.classes.map((c) => c.name),
        newStructure.classes.map((c) => c.name)
      );

      // 加权平均：函数50%，类30%，导入20%
      const similarity = funcSim * 0.5 + classSim * 0.3 + importSim * 0.2;

      // 转换为百分比，保留两位小数
      return Math.round(similarity * 10000) / 100;
    } catch {
      // 解析失败返回0
      return 0;
    }
  }

  /**
   * 计算两个集合的相似度
   * 使用 Jaccard 系数：交集大小 / 并集大小
   * 
   * @param arr1 - 第一个数组
   * @param arr2 - 第二个数组
   * @returns number - 相似度 0-1
   */
  private calculateSetSimilarity(arr1: string[], arr2: string[]): number {
    const set1 = new Set(arr1);
    const set2 = new Set(arr2);

    // 如果两个集合都为空，相似度为1
    if (set2.size === 0) {
      return set1.size === 0 ? 1 : 0;
    }

    // 计算交集
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    // 计算并集
    const union = new Set([...set1, ...set2]);

    // Jaccard 系数 = 交集大小 / 并集大小
    return intersection.size / union.size;
  }
}
