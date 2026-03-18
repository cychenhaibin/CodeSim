// ========================================================================
// components/CodeDiffViewer.tsx
// 代码对比视图组件
// 负责展示两份代码的并排对比视图，以及AST分析结果
// ========================================================================

// React 核心库和常用 Hooks
import React, { useState, useEffect, useMemo, useRef } from 'react';
// diff 库，用于文本行级差异比较
import { diffLines, Change } from 'diff';
// 导入 AST 差异分析器及其类型定义
import { 
  ASTDiffAnalyzer,  // AST分析器类
  DiffResult,        // 分析结果类型
  ASTChangeDetail,   // AST变化详情类型（未使用但保留）
  DiffStatistics     // 统计信息类型（未使用但保留）
} from '../utils/ASTDiffAnalyzer';
// 导入调试面板组件
import ASTDebugPanel from './ASTDebugPanel';
// 导入组件样式
import './CodeDiffViewer.css';

/**
 * 对连续的「删除+新增」块做二次逐行 diff
 * 
 * 目的：当一个块同时包含删除和新增时，可能其中有些行是相同的，
 * 通过二次 diff 可以精确识别出哪些行真正变化了，哪些行只是位置移动
 * 
 * 例如：
 * 删除块: "A\nB\nC"
 * 新增块: "A\nX\nC"
 * 
 * 经过二次diff后，A和C会被识别为未变化，只有B→X是真正的变化
 * 
 * @param changes - 原始的变化数组（来自diff库）
 * @returns Change[] - 处理后的变化数组
 */
function expandLineChanges(changes: Change[]): Change[] {
  const out: Change[] = [];  // 输出数组
  
  // 遍历所有变化块
  for (let i = 0; i < changes.length; i++) {
    const cur = changes[i];      // 当前变化块
    const next = changes[i + 1]; // 下一个变化块
    
    // 如果当前是删除块，且下一个是新增块，说明是「替换」操作
    if (cur.removed && next?.added) {
      // 对删除和新增的内容做二次diff，得到更精确的差异
      const inner = diffLines(cur.value, next.value);
      out.push(...inner);  // 将二次diff的结果加入输出
      i++;  // 跳过下一个块（已处理）
    } else {
      // 否则直接保留原样
      out.push(cur);
    }
  }
  
  return out;
}

/**
 * 组件属性接口定义
 */
interface CodeDiffViewerProps {
  oldCode: string;      // 旧版本代码内容
  newCode: string;      // 新版本代码内容
  oldFileName: string;  // 旧文件名/路径
  newFileName: string;  // 新文件名/路径（当前未使用）
  language?: string;    // 代码语言（当前未使用）
  onBack?: () => void;  // 返回按钮的回调函数
}

/**
 * 代码对比视图组件
 * 
 * 主要功能：
 * 1. 并排展示新旧代码
 * 2. 高亮显示差异行（绿色=新增，红色=删除）
 * 3. 显示AST分析结果和统计信息
 * 4. 提供调试面板查看分析过程
 */
const CodeDiffViewer: React.FC<CodeDiffViewerProps> = ({
  oldCode,
  newCode,
  oldFileName,
  newFileName,    // 解构但未使用
  language = 'typescript',  // 默认语言（解构但未使用）
  onBack,
}) => {
  // ===== 状态定义 =====
  
  // 存储AST分析结果
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  
  // 是否显示详情区域（当前始终为true）
  const [showDetails, setShowDetails] = useState(true);
  
  // 是否显示调试面板
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // ===== 创建分析器实例 =====
  // 使用 useMemo 确保只创建一次
  const analyzer = useMemo(() => {
    const a = new ASTDiffAnalyzer();
    a.enableDebug(); // 始终启用调试模式以收集数据
    return a;
  }, []); // 空依赖数组，只在组件挂载时创建

  // ===== 执行差异分析 =====
  // 当代码变化时重新分析
  useEffect(() => {
    // 调用分析器的 analyzeDiff 方法
    const result = analyzer.analyzeDiff(oldCode, newCode);
    // 将结果存入状态
    setDiffResult(result);
  }, [oldCode, newCode, analyzer]); // 依赖：代码内容和分析器

  // ===== 处理行级变化 =====
  // 对原始diff结果做二次处理，提高精确度
  const expandedChanges = useMemo(
    () => (diffResult ? expandLineChanges(diffResult.lineChanges) : []),
    [diffResult]
  );
  
  // 构建左右两侧的显示数据
  const { leftLines, rightLines } = buildSideBySideView(
    oldCode,
    newCode,
    expandedChanges
  );

  // ===== 滚动同步功能 =====
  // 左侧面板的引用
  const leftPaneRef = useRef<HTMLDivElement>(null);
  // 右侧面板的引用
  const rightPaneRef = useRef<HTMLDivElement>(null);
  // 同步锁，防止滚动事件互相触发导致死循环
  const syncingRef = useRef(false);

  // 设置滚动同步
  useEffect(() => {
    const left = leftPaneRef.current;
    const right = rightPaneRef.current;
    
    // 如果引用不存在，直接返回
    if (!left || !right) return;

    /**
     * 从左侧同步到右侧
     * 当左侧滚动时，将右侧滚动到相同位置
     */
    const syncFromLeft = () => {
      // 如果正在同步中，跳过（防止死循环）
      if (syncingRef.current) return;
      syncingRef.current = true;  // 设置同步锁
      
      // 同步滚动位置
      right.scrollTop = left.scrollTop;
      right.scrollLeft = left.scrollLeft;
      
      // 在下一帧释放同步锁
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    
    /**
     * 从右侧同步到左侧
     * 当右侧滚动时，将左侧滚动到相同位置
     */
    const syncFromRight = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      
      left.scrollTop = right.scrollTop;
      left.scrollLeft = right.scrollLeft;
      
      requestAnimationFrame(() => { syncingRef.current = false; });
    };

    // 添加滚动事件监听器
    left.addEventListener('scroll', syncFromLeft, { passive: true });
    right.addEventListener('scroll', syncFromRight, { passive: true });
    
    // 清理函数：组件卸载时移除监听器
    return () => {
      left.removeEventListener('scroll', syncFromLeft);
      right.removeEventListener('scroll', syncFromRight);
    };
  }, [diffResult]); // 当 diffResult 变化时重新设置

  // ===== 加载状态 =====
  // 分析结果为空时显示加载提示
  if (!diffResult) {
    return <div className="loading">分析中...</div>;
  }

  // ===== 渲染组件 =====
  return (
    <div className="code-diff-viewer">
      {/* ===== 头部信息区域 ===== */}
      <div className="diff-header">
        {/* 标题 */}
        <div className="diff-title">代码对比 (vue-diff)</div>
        
        {/* 操作按钮区域 */}
        <div className="header-actions">
          {/* 调试面板切换按钮 */}
          <button
            type="button"
            className={`debug-toggle-button ${showDebugPanel ? 'active' : ''}`}
            onClick={() => setShowDebugPanel(!showDebugPanel)}
          >
            {/* 根据状态显示不同文字 */}
            {showDebugPanel ? '隐藏调试' : '查看 AST 分析过程'}
          </button>
          
          {/* 返回按钮（仅当提供了 onBack 回调时显示） */}
          {onBack && (
            <button type="button" className="header-back-button" onClick={onBack}>
              返回重新选择
            </button>
          )}
        </div>
      </div>

      {/* ===== AST 调试面板 ===== */}
      {/* 当显示开关为true且调试信息存在时渲染 */}
      {showDebugPanel && diffResult.debugInfo && (
        <ASTDebugPanel 
          debugInfo={diffResult.debugInfo}
          onClose={() => setShowDebugPanel(false)}
        />
      )}

      {/* ===== 文件信息和统计区域 ===== */}
      <div className="diff-info">
        {/* 文件路径 */}
        <div className="file-info">
          <span className="label">文件对路径:</span>
          <span className="file-path">{oldFileName}</span>
        </div>
        
        {/* 行级统计信息 */}
        <div className='file-info ast-structure-row'>
          <span className="stats">
            相同行 / 总行:{' '}
            {/* 计算相同行数 = 总行数 - 修改行数 */}
            {diffResult.statistics.totalLines - diffResult.statistics.modifiedLines} /{' '}
            {diffResult.statistics.totalLines} ({diffResult.statistics.similarity.toFixed(2)}%)
          </span>
        </div>
        
        {/* AST结构相似度 */}
        <div className="file-info ast-structure-row">
          <span className="label">AST 结构相似度:</span>
          <span className="ast-similarity-value">{diffResult.astStructureSimilarity.toFixed(2)}%</span>
        </div>
      </div>

      {/* ===== AST 树结构差异列表 ===== */}
      {/* 当有差异且显示详情时渲染 */}
      {showDetails && diffResult.astStructureChanges.length > 0 && (
        <div className="diff-details ast-structure-details">
          <div className="details-title">AST 树结构差异</div>
          <ol className="changes-list">
            {/* 最多显示10条 */}
            {diffResult.astStructureChanges.slice(0, 10).map((change, index) => (
              <li key={index} className={`change-item ast-structure ${change.type}`}>
                <span className="change-type">{change.type === 'removed' ? '移除' : '新增'}:</span>
                <span className="change-description">{change.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ===== 语义差异详情（导入/函数/类等） ===== */}
      {showDetails && diffResult.astChanges.length > 0 && (
        <div className="diff-details">
          <div className="details-title">差异详情（导入/函数/类等）</div>
          <ol className="changes-list">
            {/* 最多显示5条 */}
            {diffResult.astChanges.slice(0, 5).map((change, index) => (
              <li key={index} className={`change-item ${change.severity}`}>
                <span className="change-type">{getChangeTypeLabel(change.type)}:</span>
                <span className="change-description">{change.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ===== 并排代码对比区域 ===== */}
      <div className="diff-container">
        {/* 左侧面板：旧代码 */}
        <div ref={leftPaneRef} className="diff-pane left-pane">
          <div className="pane-content">
            {/* 遍历渲染每一行 */}
            {leftLines.map((line, index) => (
              <div
                key={index}
                className={`code-line ${line.type}`}  // 根据类型应用不同样式
                data-line-number={line.lineNumber}
              >
                {/* 行号 */}
                <span className="line-number">{line.lineNumber || ''}</span>
                {/* 标记符（-表示删除，+表示新增） */}
                <span className="line-marker">{line.marker}</span>
                {/* 代码内容 */}
                <pre className="line-content">{line.content}</pre>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧面板：新代码 */}
        <div ref={rightPaneRef} className="diff-pane right-pane">
          <div className="pane-content">
            {rightLines.map((line, index) => (
              <div
                key={index}
                className={`code-line ${line.type}`}
                data-line-number={line.lineNumber}
              >
                <span className="line-number">{line.lineNumber || ''}</span>
                <span className="line-marker">{line.marker}</span>
                <pre className="line-content">{line.content}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ========================================================================
// 辅助类型和函数
// ========================================================================

/**
 * 行数据接口
 * 表示一行代码的显示信息
 */
interface LineData {
  lineNumber: number | null;  // 行号（空行为null）
  content: string;            // 代码内容
  type: 'normal' | 'added' | 'removed' | 'empty';  // 行类型
  marker: string;             // 标记符（-/+/空）
}

/**
 * 规范化行内容（保留一个空格）
 * 用于判断两行内容是否等价
 * 
 * @param s - 原始字符串
 * @returns 规范化后的字符串
 */
const normalizeLine = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * 去除所有空白字符
 * 用于判断换行格式不同但内容相同的代码
 * 
 * @param s - 原始字符串
 * @returns 去除空白后的字符串
 */
const normalizeStripAllWs = (s: string) => s.replace(/\s/g, '');

/**
 * 应该忽略的 JSX 样式属性名
 * 这些属性值的变化不影响功能结构
 */
const IGNORED_STYLE_ATTRIBUTES = new Set([
  'style', 'className', 'class', 'width', 'height', 'minWidth', 'maxWidth',
  'minHeight', 'maxHeight', 'margin', 'marginTop', 'marginBottom', 'marginLeft',
  'marginRight', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft',
  'paddingRight', 'color', 'backgroundColor', 'background', 'border',
  'borderWidth', 'borderColor', 'borderRadius', 'fontSize', 'fontWeight',
  'fontFamily', 'lineHeight', 'textAlign', 'display', 'position', 'top',
  'bottom', 'left', 'right', 'zIndex', 'opacity', 'flex', 'flexDirection',
  'justifyContent', 'alignItems', 'gap', 'transform', 'transition', 'animation',
  'boxShadow', 'overflow', 'cursor', 'size', 'sx', 'css',
]);

/**
 * 将行内容转换为「结构模式」
 * 把标识符（变量名/函数名）替换为占位符，保留代码结构
 * 同时忽略样式属性的值
 * 
 * 例如：
 * "const FormModalComponentdehbdh: React.FC = () => {"
 * 转换为：
 * "const _ID_: _ID_._ID_ = () => {"
 * 
 * "<div style={{ width: 100 }}>" 和 "<div style={{ width: 200 }}>"
 * 会被转换为相同的模式
 * 
 * 这样两个只有标识符或样式值不同的行会有相同的模式
 * 
 * @param s - 原始字符串
 * @returns 结构模式字符串
 */
const normalizeToPattern = (s: string): string => {
  // JavaScript/TypeScript 关键字列表，这些不应该被替换
  const keywords = new Set([
    'const', 'let', 'var', 'function', 'class', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'return', 'throw', 'try',
    'catch', 'finally', 'new', 'delete', 'typeof', 'instanceof', 'void',
    'this', 'super', 'import', 'export', 'default', 'from', 'as', 'async',
    'await', 'yield', 'static', 'get', 'set', 'extends', 'implements',
    'interface', 'type', 'enum', 'namespace', 'module', 'declare', 'readonly',
    'public', 'private', 'protected', 'abstract', 'true', 'false', 'null',
    'undefined', 'NaN', 'Infinity', 'of', 'in'
  ]);
  
  // 循环等价的数组方法
  const loopEquivalentMethods = new Set([
    'forEach', 'map', 'filter', 'reduce', 'reduceRight',
    'find', 'findIndex', 'some', 'every', 'flatMap'
  ]);
  
  // 先规范化空白
  let normalized = s.trim().replace(/\s+/g, ' ');
  
  // ===== 功能等价转换 =====
  
  // 0. 移除 TypeScript 类型注解（不影响功能）
  // const foo: Type = ... → const foo = ...
  // Array<T> 和 T[] 等类型写法差异会被忽略
  normalized = normalized.replace(/:\s*[A-Za-z_$][A-Za-z0-9_$<>\[\],\s|&]*(?=\s*[=,)\]])/g, '');
  
  // 0.1 移除 React Hooks 包装（useMemo/useCallback 不影响功能本质）
  // const foo = useMemo(() => [...], [deps]) → const foo = [...]
  // const foo = useCallback(() => {...}, [deps]) → const foo = () => {...}
  normalized = normalized.replace(/=\s*useMemo\s*\(\s*\(\)\s*=>\s*/g, '= ');
  normalized = normalized.replace(/=\s*useCallback\s*\(\s*/g, '= ');
  
  // 1. 统一函数声明形式
  // function foo(...) → _FUNC_DECL_ (...)
  // const foo = function(...) → _FUNC_DECL_ (...)
  // const foo = (...) => → _FUNC_DECL_ (...)
  normalized = normalized.replace(/\bfunction\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*function\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*async\s+function\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*async\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  normalized = normalized.replace(/\basync\s+function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  
  // 2. 统一循环形式
  // for (...) → _LOOP_ (...)
  // while (...) → _LOOP_ (...)
  // do { → _LOOP_ {
  normalized = normalized.replace(/\bfor\s*\(/g, '_LOOP_ (');
  normalized = normalized.replace(/\bwhile\s*\(/g, '_LOOP_ (');
  normalized = normalized.replace(/\bdo\s*\{/g, '_LOOP_ {');
  
  // 3. 统一条件形式
  // if (...) → _COND_ (...)
  // 三元运算符稍后处理
  normalized = normalized.replace(/\bif\s*\(/g, '_COND_ (');
  
  // ===== 原有的规范化逻辑 =====
  
  // 忽略样式属性的值：width={100} -> width={_STYLE_}
  for (const attr of IGNORED_STYLE_ATTRIBUTES) {
    const jsxPattern1 = new RegExp(`\\b${attr}=\\{[^}]*\\}`, 'g');
    const jsxPattern2 = new RegExp(`\\b${attr}="[^"]*"`, 'g');
    const jsxPattern3 = new RegExp(`\\b${attr}='[^']*'`, 'g');
    const objPattern = new RegExp(`\\b${attr}:\\s*[^,}]+`, 'g');
    
    normalized = normalized.replace(jsxPattern1, `${attr}={_STYLE_}`);
    normalized = normalized.replace(jsxPattern2, `${attr}="_STYLE_"`);
    normalized = normalized.replace(jsxPattern3, `${attr}='_STYLE_'`);
    normalized = normalized.replace(objPattern, `${attr}: _STYLE_`);
  }
  
  // 将字符串字面量替换为占位符
  normalized = normalized.replace(/'[^']*'/g, "'_STR_'");
  normalized = normalized.replace(/"[^"]*"/g, '"_STR_"');
  
  // 将数字字面量替换为占位符
  normalized = normalized.replace(/\b\d+(\.\d+)?\b/g, '_NUM_');
  
  // 变量声明：const/let/var xxx = ... → const/let/var _ID_ = ...
  normalized = normalized.replace(/\b(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1 _ID_');
  
  // 函数参数声明：(xxx, yyy) => 或 function(xxx, yyy)
  normalized = normalized.replace(/\(([^)]*)\)\s*(=>|{)/g, (_match, params, arrow) => {
    const normalizedParams = params.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::|,|\))/g, (m: string, id: string) => {
      if (keywords.has(id)) return m;
      return m.replace(id, '_ID_');
    });
    return `(${normalizedParams}) ${arrow}`;
  });
  
  // 4. 统一循环等价的数组方法
  // .forEach(...) → ._LOOP_METHOD_(...)
  // .map(...) → ._LOOP_METHOD_(...)
  for (const method of loopEquivalentMethods) {
    const methodPattern = new RegExp(`\\.${method}\\s*\\(`, 'g');
    normalized = normalized.replace(methodPattern, '._LOOP_METHOD_(');
  }
  
  // 函数调用的参数值：foo(a, b) → foo(_ARG_, _ARG_)
  normalized = normalized.replace(/\(([^)]+)\)/g, (_match, args) => {
    const normalizedArgs = args.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g, (m: string) => {
      if (keywords.has(m)) return m;
      if (/^[A-Z]/.test(m)) return m;
      return '_ARG_';
    });
    return `(${normalizedArgs})`;
  });
  
  return normalized;
};

/**
 * 将「仅位置/格式不同、内容等价」的删除行与新增行配对，标为未改动
 * 
 * 这个函数的作用是减少"假差异"：
 * 例如代码只是换了个位置，或者只是换行格式不同（如 <></> 和 <>\n</>）
 * 这些情况不应该被标记为差异
 * 
 * @param leftLines - 左侧（旧代码）的行数据数组
 * @param rightLines - 右侧（新代码）的行数据数组
 */
function markMovedLinesAsUnchanged(
  leftLines: LineData[],
  rightLines: LineData[]
): void {
  // 记录已匹配的行索引
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();

  // ===== 策略0：空行匹配 =====
  // 空行（只包含空白字符的行）之间互相匹配，不应该高亮
  // 收集所有空行的索引
  const emptyRemovedIndices: number[] = [];
  const emptyAddedIndices: number[] = [];
  
  for (let i = 0; i < leftLines.length; i++) {
    if (leftLines[i].type === 'removed' && leftLines[i].content.trim() === '') {
      emptyRemovedIndices.push(i);
    }
  }
  
  for (let j = 0; j < rightLines.length; j++) {
    if (rightLines[j].type === 'added' && rightLines[j].content.trim() === '') {
      emptyAddedIndices.push(j);
    }
  }
  
  // 匹配空行（按数量配对）
  const emptyMatchCount = Math.min(emptyRemovedIndices.length, emptyAddedIndices.length);
  for (let k = 0; k < emptyMatchCount; k++) {
    const i = emptyRemovedIndices[k];
    const j = emptyAddedIndices[k];
    
    matchedLeft.add(i);
    matchedRight.add(j);
    leftLines[i].type = 'normal';
    leftLines[i].marker = '';
    rightLines[j].type = 'normal';
    rightLines[j].marker = '';
  }
  
  // 对于多余的空行（一边多出来的），也标记为 normal（空行差异不重要）
  for (let k = emptyMatchCount; k < emptyRemovedIndices.length; k++) {
    const i = emptyRemovedIndices[k];
    matchedLeft.add(i);
    leftLines[i].type = 'normal';
    leftLines[i].marker = '';
  }
  
  for (let k = emptyMatchCount; k < emptyAddedIndices.length; k++) {
    const j = emptyAddedIndices[k];
    matchedRight.add(j);
    rightLines[j].type = 'normal';
    rightLines[j].marker = '';
  }

  // ===== 策略1：按「规范化行」逐行匹配 =====
  // 将内容相同（忽略空白差异）的删除行和新增行配对
  
  // 构建删除行的索引映射：规范化内容 -> 行索引数组
  const removedByNorm = new Map<string, number[]>();
  // 构建新增行的索引映射
  const addedByNorm = new Map<string, number[]>();
  
  // 遍历左侧所有删除行
  for (let i = 0; i < leftLines.length; i++) {
    // 跳过非删除行、已匹配行和空行
    if (matchedLeft.has(i) || leftLines[i].type !== 'removed' || leftLines[i].content.trim() === '') continue;
    // 计算规范化后的内容作为键
    const key = normalizeLine(leftLines[i].content);
    // 添加到映射
    if (!removedByNorm.has(key)) removedByNorm.set(key, []);
    removedByNorm.get(key)!.push(i);
  }
  
  // 遍历右侧所有新增行
  for (let j = 0; j < rightLines.length; j++) {
    if (matchedRight.has(j) || rightLines[j].type !== 'added' || rightLines[j].content.trim() === '') continue;
    const key = normalizeLine(rightLines[j].content);
    if (!addedByNorm.has(key)) addedByNorm.set(key, []);
    addedByNorm.get(key)!.push(j);
  }
  
  // 匹配内容相同的删除行和新增行
  removedByNorm.forEach((leftIndices, key) => {
    const rightIndices = addedByNorm.get(key);
    if (!rightIndices) return;  // 没有匹配的新增行
    
    // 取较小的数量进行配对
    const n = Math.min(leftIndices.length, rightIndices.length);
    for (let k = 0; k < n; k++) {
      const i = leftIndices[k];
      const j = rightIndices[k];
      
      // 标记为已匹配
      matchedLeft.add(i);
      matchedRight.add(j);
      
      // 将类型改为normal（不高亮）
      leftLines[i].type = 'normal';
      leftLines[i].marker = '';
      rightLines[j].type = 'normal';
      rightLines[j].marker = '';
    }
  });

  // ===== 策略1.5：按「结构模式」匹配 =====
  // 识别只有标识符（变量名/函数名）不同，但结构相同的行
  // 例如：const FooComponent: React.FC = () => { 和 const BarComponent: React.FC = () => {
  
  // 构建删除行的模式映射：结构模式 -> 行索引数组
  const removedByPattern = new Map<string, number[]>();
  const addedByPattern = new Map<string, number[]>();
  
  for (let i = 0; i < leftLines.length; i++) {
    // 跳过已匹配的行、非删除行、空行
    if (matchedLeft.has(i) || leftLines[i].type !== 'removed' || leftLines[i].content.trim() === '') continue;
    const pattern = normalizeToPattern(leftLines[i].content);
    if (!removedByPattern.has(pattern)) removedByPattern.set(pattern, []);
    removedByPattern.get(pattern)!.push(i);
  }
  
  for (let j = 0; j < rightLines.length; j++) {
    if (matchedRight.has(j) || rightLines[j].type !== 'added' || rightLines[j].content.trim() === '') continue;
    const pattern = normalizeToPattern(rightLines[j].content);
    if (!addedByPattern.has(pattern)) addedByPattern.set(pattern, []);
    addedByPattern.get(pattern)!.push(j);
  }
  
  // 匹配结构模式相同的行
  removedByPattern.forEach((leftIndices, pattern) => {
    const rightIndices = addedByPattern.get(pattern);
    if (!rightIndices) return;
    
    const n = Math.min(leftIndices.length, rightIndices.length);
    for (let k = 0; k < n; k++) {
      const i = leftIndices[k];
      const j = rightIndices[k];
      
      // 跳过已被其他策略匹配的行
      if (matchedLeft.has(i) || matchedRight.has(j)) continue;
      
      matchedLeft.add(i);
      matchedRight.add(j);
      leftLines[i].type = 'normal';
      leftLines[i].marker = '';
      rightLines[j].type = 'normal';
      rightLines[j].marker = '';
    }
  });

  // ===== 策略1.6：JSX 标签顺序匹配 =====
  // 处理 JSX 标签只是属性顺序不同的情况
  // 例如：<div id="a" className="b"> 和 <div className="b" id="a">
  
  // 将 JSX 属性排序后比较
  const normalizeJSXAttributes = (s: string): string => {
    // 提取 JSX 标签：<TagName attr1={} attr2="" ...>
    const jsxMatch = s.match(/^(\s*<\/?[\w.]+)\s*(.*?)(\/?>?\s*)$/);
    if (!jsxMatch) return normalizeToPattern(s);
    
    const [, tagStart, attrsStr, tagEnd] = jsxMatch;
    
    // 提取所有属性并排序
    const attrs: string[] = [];
    // 简单的属性提取（支持 attr={...}, attr="...", attr='...', attr）
    const attrRegex = /(\w+)(?:=(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s>]+))?/g;
    let match;
    while ((match = attrRegex.exec(attrsStr)) !== null) {
      const attrName = match[1];
      // 如果是样式属性，忽略其值
      if (IGNORED_STYLE_ATTRIBUTES.has(attrName)) {
        attrs.push(`${attrName}=_STYLE_`);
      } else {
        attrs.push(normalizeToPattern(match[0]));
      }
    }
    
    // 排序属性（忽略顺序）
    attrs.sort();
    
    return `${normalizeToPattern(tagStart)} ${attrs.join(' ')} ${tagEnd.trim()}`;
  };
  
  const removedByJSX = new Map<string, number[]>();
  const addedByJSX = new Map<string, number[]>();
  
  for (let i = 0; i < leftLines.length; i++) {
    if (matchedLeft.has(i) || leftLines[i].type !== 'removed') continue;
    const content = leftLines[i].content.trim();
    // 只处理 JSX 标签行
    if (!content.startsWith('<') || content.trim() === '') continue;
    const normalized = normalizeJSXAttributes(content);
    if (!removedByJSX.has(normalized)) removedByJSX.set(normalized, []);
    removedByJSX.get(normalized)!.push(i);
  }
  
  for (let j = 0; j < rightLines.length; j++) {
    if (matchedRight.has(j) || rightLines[j].type !== 'added') continue;
    const content = rightLines[j].content.trim();
    if (!content.startsWith('<') || content.trim() === '') continue;
    const normalized = normalizeJSXAttributes(content);
    if (!addedByJSX.has(normalized)) addedByJSX.set(normalized, []);
    addedByJSX.get(normalized)!.push(j);
  }
  
  removedByJSX.forEach((leftIndices, normalized) => {
    const rightIndices = addedByJSX.get(normalized);
    if (!rightIndices) return;
    
    const n = Math.min(leftIndices.length, rightIndices.length);
    for (let k = 0; k < n; k++) {
      const i = leftIndices[k];
      const j = rightIndices[k];
      
      if (matchedLeft.has(i) || matchedRight.has(j)) continue;
      
      matchedLeft.add(i);
      matchedRight.add(j);
      leftLines[i].type = 'normal';
      leftLines[i].marker = '';
      rightLines[j].type = 'normal';
      rightLines[j].marker = '';
    }
  });

  // ===== 策略2：块匹配 - 多行删除 vs 单行新增 =====
  // 处理如 "<>\n</>" 与 "<></>" 的情况
  // 多行删除的内容合并后等于单行新增
  
  // 获取未匹配的删除行索引（保持顺序）
  const removedOrdered = leftLines
    .map((_, i) => i)
    .filter((i) => leftLines[i].type === 'removed' && !matchedLeft.has(i));
  
  // 遍历所有新增行
  for (let j = 0; j < rightLines.length; j++) {
    // 跳过非新增行和已匹配行
    if (rightLines[j].type !== 'added' || matchedRight.has(j)) continue;
    
    // 计算新增行去除空白后的内容
    const R = normalizeStripAllWs(rightLines[j].content);
    if (R === '') continue;  // 跳过空行
    
    // 尝试找到连续的删除行，使得合并后等于新增行
    for (let start = 0; start < removedOrdered.length; start++) {
      if (matchedLeft.has(removedOrdered[start])) continue;
      
      let concat = '';        // 累积的合并内容
      const used: number[] = [];  // 使用的删除行索引
      
      // 尝试合并连续的删除行
      for (let len = 1; start + len <= removedOrdered.length; len++) {
        const idx = removedOrdered[start + len - 1];
        if (matchedLeft.has(idx)) break;
        
        // 累加删除行的内容（去除空白）
        concat += normalizeStripAllWs(leftLines[idx].content);
        used.push(idx);
        
        // 如果合并后等于新增行的内容，说明匹配成功
        if (concat === R) {
          // 将所有参与合并的删除行标记为normal
          used.forEach((i) => {
            matchedLeft.add(i);
            leftLines[i].type = 'normal';
            leftLines[i].marker = '';
          });
          // 将新增行也标记为normal
          matchedRight.add(j);
          rightLines[j].type = 'normal';
          rightLines[j].marker = '';
          break;
        }
        
        // 如果已经超过目标长度，放弃
        if (concat.length >= R.length) break;
      }
      
      // 如果已匹配，跳出循环
      if (matchedRight.has(j)) break;
    }
  }

  // ===== 策略3：块匹配 - 单行删除 vs 多行新增 =====
  // 处理如 "<></>" 与 "<>\n</>" 的情况（与策略2相反）
  // 单行删除的内容等于多行新增合并后的内容
  
  // 获取未匹配的新增行索引
  const addedOrdered = rightLines
    .map((_, j) => j)
    .filter((j) => rightLines[j].type === 'added' && !matchedRight.has(j));
  
  // 遍历所有删除行
  for (let i = 0; i < leftLines.length; i++) {
    if (leftLines[i].type !== 'removed' || matchedLeft.has(i)) continue;
    
    // 计算删除行去除空白后的内容
    const L = normalizeStripAllWs(leftLines[i].content);
    if (L === '') continue;
    
    // 尝试找到连续的新增行，使得合并后等于删除行
    for (let start = 0; start < addedOrdered.length; start++) {
      if (matchedRight.has(addedOrdered[start])) continue;
      
      let concat = '';
      const used: number[] = [];
      
      for (let len = 1; start + len <= addedOrdered.length; len++) {
        const idx = addedOrdered[start + len - 1];
        if (matchedRight.has(idx)) break;
        
        concat += normalizeStripAllWs(rightLines[idx].content);
        used.push(idx);
        
        if (concat === L) {
          // 匹配成功，标记所有参与的行为normal
          used.forEach((j) => {
            matchedRight.add(j);
            rightLines[j].type = 'normal';
            rightLines[j].marker = '';
          });
          matchedLeft.add(i);
          leftLines[i].type = 'normal';
          leftLines[i].marker = '';
          break;
        }
        
        if (concat.length >= L.length) break;
      }
      
      if (matchedLeft.has(i)) break;
    }
  }
}

/**
 * 构建并排视图的数据
 * 将diff结果转换为左右两侧的行数据数组
 * 
 * @param oldCode - 旧代码（未使用，保留参数）
 * @param newCode - 新代码（未使用，保留参数）
 * @param changes - diff变化数组
 * @returns 包含左右两侧行数据的对象
 */
function buildSideBySideView(oldCode: string, newCode: string, changes: any[]) {
  const leftLines: LineData[] = [];   // 左侧行数据
  const rightLines: LineData[] = [];  // 右侧行数据

  let oldLineNum = 1;  // 旧代码行号计数器
  let newLineNum = 1;  // 新代码行号计数器

  // 遍历所有变化块
  for (const change of changes) {
    // 将变化块的内容按换行符分割成行数组
    const lines = change.value.split('\n');
    
    // 移除末尾的空字符串（由最后的换行符产生）
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (change.removed) {
      // ===== 删除的行 =====
      for (const line of lines) {
        // 左侧显示删除的行
        leftLines.push({
          lineNumber: oldLineNum++,  // 分配行号
          content: line,
          type: 'removed',
          marker: '-',  // 删除标记
        });
        // 右侧显示空行（占位，保持对齐）
        rightLines.push({
          lineNumber: null,
          content: '',
          type: 'empty',
          marker: '',
        });
      }
    } else if (change.added) {
      // ===== 新增的行 =====
      for (const line of lines) {
        // 左侧显示空行（占位）
        leftLines.push({
          lineNumber: null,
          content: '',
          type: 'empty',
          marker: '',
        });
        // 右侧显示新增的行
        rightLines.push({
          lineNumber: newLineNum++,
          content: line,
          type: 'added',
          marker: '+',  // 新增标记
        });
      }
    } else {
      // ===== 未变化的行 =====
      for (const line of lines) {
        // 左右两侧显示相同内容
        leftLines.push({
          lineNumber: oldLineNum++,
          content: line,
          type: 'normal',
          marker: '',
        });
        rightLines.push({
          lineNumber: newLineNum++,
          content: line,
          type: 'normal',
          marker: '',
        });
      }
    }
  }

  // 调用智能匹配函数，减少"假差异"
  markMovedLinesAsUnchanged(leftLines, rightLines);
  
  return { leftLines, rightLines };
}

/**
 * 获取变化类型的中文标签
 * 
 * @param type - 变化类型（added/removed/modified）
 * @returns 中文标签
 */
function getChangeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    added: '新增',
    removed: '移除',
    modified: '修改',
  };
  return labels[type] || type;  // 未知类型返回原值
}

// 导出组件
export default CodeDiffViewer;
