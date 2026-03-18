// ========================================================================
// components/CodeDiffViewer.tsx
// 代码对比视图组件 - AST + GraphCodeBERT 版本
// ========================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { diffLines, Change } from 'diff';
import { DiffResult, ASTDiffAnalyzer } from '../utils/ASTDiffAnalyzer';
import { Drawer, Button, Tag, Steps, Divider, Spin, Tooltip } from 'antd';
import { CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import './CodeDiffViewer.css';

/**
 * 对连续的「删除+新增」块做二次逐行 diff
 */
function expandLineChanges(changes: Change[]): Change[] {
  const out: Change[] = [];
  
  for (let i = 0; i < changes.length; i++) {
    const cur = changes[i];
    const next = changes[i + 1];
    
    if (cur.removed && next?.added) {
      const inner = diffLines(cur.value, next.value);
      out.push(...inner);
      i++;
    } else {
      out.push(cur);
    }
  }
  
  return out;
}

/**
 * AST 向量编码相似度响应
 */
interface VectorDebugInfo {
  cls_norm: number;
  mean_norm: number;
  combined_norm: number;
  bpe_tokens: number;
  windows: number;
}

interface ASTSimilarityResponse {
  similarity: number;
  similarity_percent: number;
  interpretation: string;
  sbt1_tokens: number;
  sbt2_tokens: number;
  code1_vector?: VectorDebugInfo;
  code2_vector?: VectorDebugInfo;
}

/**
 * GraphCodeBERT 相似度响应
 */
interface ModelSimilarityResponse {
  similarity: number;
  similarity_percent: number;
  interpretation: string;
  raw_cosine_similarity?: number;
  text_similarity?: number;
  code1_analysis?: { token_count: number; dfg_edges: number };
  code2_analysis?: { token_count: number; dfg_edges: number };
}

/**
 * 组件属性接口定义
 */
interface CodeDiffViewerProps {
  oldCode: string;
  newCode: string;
  oldFileName: string;
  newFileName: string;
  diffResult: DiffResult;
  astSimilarity: ASTSimilarityResponse | null;
  modelSimilarity: ModelSimilarityResponse | null;
  onBack?: () => void;
}

/**
 * 代码对比视图组件
 */
const CodeDiffViewer: React.FC<CodeDiffViewerProps> = ({
  oldCode,
  newCode,
  oldFileName,
  diffResult,
  astSimilarity,
  modelSimilarity,
  onBack,
}) => {
  // 折叠状态
  const [collapsed, setCollapsed] = useState(false);
  // 当前打开的详情面板: null | 'ast-vector' | 'ast-structure' | 'semantic'
  const [detailPanel, setDetailPanel] = useState<string | null>(null);

  // 处理行级变化
  const expandedChanges = useMemo(
    () => expandLineChanges(diffResult.lineChanges),
    [diffResult]
  );
  
  // 构建左右两侧的显示数据
  const { leftLines, rightLines } = buildSideBySideView(
    oldCode,
    newCode,
    expandedChanges
  );

  // 滚动同步功能
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const left = leftPaneRef.current;
    const right = rightPaneRef.current;
    
    if (!left || !right) return;

    const syncFromLeft = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      right.scrollTop = left.scrollTop;
      right.scrollLeft = left.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    
    const syncFromRight = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      left.scrollTop = right.scrollTop;
      left.scrollLeft = right.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };

    left.addEventListener('scroll', syncFromLeft, { passive: true });
    right.addEventListener('scroll', syncFromRight, { passive: true });
    
    return () => {
      left.removeEventListener('scroll', syncFromLeft);
      right.removeEventListener('scroll', syncFromRight);
    };
  }, [diffResult]);

  // 加载状态
  if (!diffResult) {
    return (
      <div className="loading">
        <Spin size="large" />
        <span style={{ marginLeft: 12 }}>分析中...</span>
      </div>
    );
  }

  return (
    <div className="code-diff-viewer">
      {/* 头部信息区域 */}
      <div className="diff-header">
        <div className="diff-title">AST + GraphCodeBERT 代码对比</div>
        <div className="header-actions">
          {onBack && (
            <Button type="default" size="small" onClick={onBack}>
              返回重新选择
            </Button>
          )}
        </div>
      </div>

      {/* 统计信息区域 */}
      <div className="diff-info">
        <div className="file-info">
          <span className="label">文件路径:</span>
          <span className="file-path">{oldFileName}</span>
        </div>
        
        {/* 行级统计 */}
        <div className="file-info ast-structure-row">
          <span className="stats">
            相同行 / 总行:{' '}
            {diffResult.statistics.totalLines - diffResult.statistics.modifiedLines} /{' '}
            {diffResult.statistics.totalLines} ({diffResult.statistics.similarity.toFixed(2)}%)
          </span>
        </div>
        
        {/* AST 向量编码相似度（核心） */}
        {astSimilarity && (
          <div className="file-info ast-vector-row">
            <Tooltip title="基于 AST SBT 序列化 + GraphCodeBERT 向量编码的余弦相似度">
              <span className="label">AST 向量相似度:</span>
            </Tooltip>
            <span className={`ast-vector-value ${astSimilarity.similarity >= 0.85 ? 'high' : astSimilarity.similarity >= 0.5 ? 'medium' : 'low'}`}>
              {astSimilarity.similarity_percent.toFixed(2)}%
            </span>
            <Button size="small" className="detail-btn" onClick={() => setDetailPanel('ast-vector')}>
              计算详情
            </Button>
          </div>
        )}

        {/* AST 结构相似度（前端计算） */}
        <div className="file-info ast-structure-row">
          <Tooltip title="前端 Babel 解析 AST → 提取结构签名 → 多重集比较">
            <span className="label">AST 结构相似度:</span>
          </Tooltip>
          <span className="ast-similarity-value">{diffResult.astStructureSimilarity.toFixed(2)}%</span>
          <Button size="small" className="detail-btn" onClick={() => setDetailPanel('ast-structure')}>
            计算详情
          </Button>
        </div>

        {/* GraphCodeBERT 语义相似度（补充参考） */}
        {modelSimilarity && (
          <div className="file-info model-similarity-row">
            <Tooltip title="基于代码 + DFG 数据流图的 GraphCodeBERT 语义编码，经文本 Jaccard 校准">
              <span className="label">语义相似度(参考):</span>
            </Tooltip>
            <span className="model-similarity-value">{modelSimilarity.similarity_percent.toFixed(2)}%</span>
            <Button size="small" className="detail-btn" onClick={() => setDetailPanel('semantic')}>
              计算详情
            </Button>
          </div>
        )}
      </div>

      {/* 可折叠的差异详情区域 */}
      {(diffResult.astStructureChanges.length > 0 || diffResult.astChanges.length > 0) && (
        <div className={`collapsible-content ${collapsed ? 'collapsed' : 'expanded'}`}>
          {/* AST 树结构差异列表 */}
          {diffResult.astStructureChanges.length > 0 && (
            <div className="diff-details ast-structure-details">
              <Divider style={{ margin: '8px 0' }} />
              <div className="details-title">AST 树结构差异</div>
              <ol className="changes-list">
                {diffResult.astStructureChanges.slice(0, 10).map((change, index) => (
                  <li key={index} className={`change-item ast-structure ${change.type}`}>
                    <Tag color={change.type === 'removed' ? 'red' : change.type === 'added' ? 'green' : 'orange'} style={{ marginRight: 6 }}>
                      {change.type === 'removed' ? '移除' : change.type === 'added' ? '新增' : '替换'}
                    </Tag>
                    <span className="change-description">{change.description}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 语义差异详情 */}
          {diffResult.astChanges.length > 0 && (
            <div className="diff-details">
              <Divider style={{ margin: '8px 0' }} />
              <div className="details-title">差异详情（导入/函数/类等）</div>
              <ol className="changes-list">
                {diffResult.astChanges.slice(0, 5).map((change, index) => (
                  <li key={index} className={`change-item ${change.severity}`}>
                    <Tag color={change.type === 'removed' ? 'red' : change.type === 'added' ? 'green' : 'orange'} style={{ marginRight: 6 }}>
                      {getChangeTypeLabel(change.type)}
                    </Tag>
                    <span className="change-description">{change.description}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* 并排代码对比区域 */}
      <div className="diff-container">
        {/* 折叠按钮 */}
        {(diffResult.astStructureChanges.length > 0 || diffResult.astChanges.length > 0) && (
          <div className="collapse-bar-wrapper">
            <Button
              type="default"
              size="small"
              className="collapse-bar-btn"
              icon={collapsed ? <CaretDownOutlined /> : <CaretUpOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '展开差异详情' : '收起差异详情'}
            </Button>
          </div>
        )}
        {/* 左侧面板：旧代码 */}
        <div ref={leftPaneRef} className="diff-pane left-pane">
          <div className="pane-content">
            {leftLines.map((line, index) => (
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

      {/* ====== SSC Drawer 计算详情抽屉 ====== */}
      <Drawer
        open={!!detailPanel}
        placement="right"
        width={880}
        className="detail-drawer"
        title={
          detailPanel === 'ast-vector'
            ? 'AST 向量相似度 — 计算过程'
            : detailPanel === 'ast-structure'
              ? 'AST 结构相似度 — 计算过程'
              : '语义相似度 — 计算过程'
        }
        onClose={() => setDetailPanel(null)}
        maskClosable
        closable
      >
        {/* ---------- AST 向量相似度 ---------- */}
        {detailPanel === 'ast-vector' && astSimilarity && (
          <div className="drawer-detail-panel">
            <Steps
              current={2}
              size="small"
              className="drawer-h-steps"
              labelPlacement="vertical"
              items={[
                { title: '前端 AST 解析 + SBT 序列化', status: 'finish' },
                { title: '后端 GraphCodeBERT 向量编码', status: 'finish' },
                { title: '余弦相似度计算', status: 'finish' },
              ]}
            />
            <div className="drawer-step-content">
              <div className="step-section">
                <div className="step-section-title">步骤 1: 前端 AST 解析 + SBT 序列化</div>
                <div className="step-desc-block">
                  <p>
                    使用 Babel 将两份代码解析为 AST，然后通过 Structure-Based Traversal
                    算法将 AST 树序列化为字符串。标识符泛化为 _ID_，字面量泛化为 _STR_/_NUM_，
                    只保留结构信息。
                  </p>
                  <div className="step-data">
                    代码A SBT token 数: <strong>{astSimilarity.sbt1_tokens}</strong>{' | '}
                    代码B SBT token 数: <strong>{astSimilarity.sbt2_tokens}</strong>
                  </div>
                  <div className="step-data-note">
                    <strong>SBT token 是什么？</strong>
                    <p>AST 树 → SBT 字符串 → 按空格拆分 = token。举个例子：</p>
                    <pre className="code-example">{`function add(a, b) {
  return a + b;
}`}</pre>
                    <p>经过 Babel 解析成 AST 后，SBT 算法前序遍历，记录每个节点的进入和离开，变量名泛化为 <code>_ID_</code>，字面量泛化为 <code>_STR_</code>/<code>_NUM_</code>，生成：</p>
                    <pre className="code-example">{`( FunctionDeclaration ( Identifier _ID_ ) ( Params ( Identifier _ID_ ) ( Identifier _ID_ ) ) ( BlockStatement ( ReturnStatement ( BinaryExpression + ( Identifier _ID_ ) ( Identifier _ID_ ) ) ) ) )`}</pre>
                    <ul>
                      <li>变量名 add、a、b 全部被泛化成 _ID_</li>
                      <li>字符串字面量会被泛化成 _STR_，数字泛化成 _NUM_</li>
                      <li>只保留了结构信息（什么节点类型、怎么嵌套的）</li>
                    </ul>
                    <p>然后把这个字符串按空格拆分，每个片段就是一个 SBT token。上面的例子大约有 20 多个 token。</p>
                    <p>token 数反映代码的<strong>结构复杂度</strong>——代码越长、嵌套越深，token 数越大。</p>
                    <p>这两个数字会被送到后端 GraphCodeBERT 模型，模型把它们编码成 768 维向量，然后计算余弦相似度。</p>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 2: 后端 GraphCodeBERT 向量编码</div>
                <div className="step-desc-block">
                  <p>
                    将两份 SBT 字符串分别输入 GraphCodeBERT 模型（microsoft/graphcodebert-base），
                    取 0.7 × [CLS] 向量 + 0.3 × MeanPooling 向量，得到两个 768 维向量。
                  </p>
                  <div className="step-data">
                    向量维度: <strong>768</strong>{' | '}
                    模型: <strong>graphcodebert-base</strong>
                  </div>
                  {astSimilarity.code1_vector && astSimilarity.code2_vector && (
                    <div className="step-vector-table">
                      <table>
                        <thead>
                          <tr>
                            <th></th>
                            <th>[CLS] 范数</th>
                            <th>MeanPooling 范数</th>
                            <th>混合向量范数</th>
                            <th>BPE token 数</th>
                            <th>滑动窗口数</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td><strong>代码 A</strong></td>
                            <td>{astSimilarity.code1_vector.cls_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code1_vector.mean_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code1_vector.combined_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code1_vector.bpe_tokens}</td>
                            <td>{astSimilarity.code1_vector.windows}</td>
                          </tr>
                          <tr>
                            <td><strong>代码 B</strong></td>
                            <td>{astSimilarity.code2_vector.cls_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code2_vector.mean_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code2_vector.combined_norm.toFixed(4)}</td>
                            <td>{astSimilarity.code2_vector.bpe_tokens}</td>
                            <td>{astSimilarity.code2_vector.windows}</td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="vector-note">
                        混合向量 = 0.7 × [CLS] + 0.3 × MeanPooling，范数 = 向量模长（L2）。
                        模型单窗口上限 512 BPE token，超出时使用滑动窗口（步长 256）分段编码后取平均，确保完整 AST 结构都被模型覆盖。
                      </p>
                    </div>
                  )}
                  <div className="step-data-note">
                    <strong>[CLS] 是什么？</strong>
                    <p>模型在输入序列最前面加一个特殊的 [CLS] token，处理完后该位置的输出向量代表整段代码的「全局语义摘要」。</p>
                    <strong>MeanPooling 是什么？</strong>
                    <p>把序列中所有 token 的输出向量取平均值，能捕捉更多分散的局部细节。</p>
                    <strong>为什么混合？</strong>
                    <p>0.7 × [CLS] 抓全局语义 + 0.3 × MeanPooling 补充局部细节，两者互补更鲁棒。</p>
                    <strong>不管 token 数多少都是 768 维？</strong>
                    <p>是的。768 是 GraphCodeBERT 的固定隐藏层维度，跟输入长度无关。不管输入 100 还是 512 个 token，输出都是一个 768 维向量。</p>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 3: 余弦相似度计算</div>
                <div className="step-desc-block">
                  <p>计算两个 768 维向量的余弦相似度:</p>
                  <div className="step-formula">cos(v1, v2) = (v1 · v2) / (|v1| × |v2|)</div>
                  <div className="step-data">
                    余弦相似度: <strong>{astSimilarity.similarity.toFixed(6)}</strong>
                  </div>
                  <div className="step-result">
                    <span className="result-label">最终得分</span>
                    <Tag color="blue" style={{ fontSize: 16, fontWeight: 700, padding: '2px 12px' }}>
                      {astSimilarity.similarity_percent.toFixed(2)}%
                    </Tag>
                    <Tag color="gray">{astSimilarity.interpretation}</Tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- AST 结构相似度 ---------- */}
        {detailPanel === 'ast-structure' && (
          <div className="drawer-detail-panel">
            <Steps
              current={2}
              size="small"
              className="drawer-h-steps"
              labelPlacement="vertical"
              items={[
                { title: '前端 Babel AST 解析', status: 'finish' },
                { title: '结构签名提取', status: 'finish' },
                { title: '多重集签名比较', status: 'finish' },
              ]}
            />
            <div className="drawer-step-content">
              <div className="step-section">
                <div className="step-section-title">步骤 1: 前端 Babel AST 解析</div>
                <div className="step-desc-block">
                  <p>使用 @babel/parser 将两份代码解析为 AST 抽象语法树。</p>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 2: 结构签名提取</div>
                <div className="step-desc-block">
                  <p>
                    遍历 AST，只提取影响功能的核心结构节点，生成归一化签名。
                    功能等价的不同写法统一为相同签名:
                  </p>
                  <ul className="step-equiv-list">
                    <li>function / 箭头函数 → <code>Function</code></li>
                    <li>if-else / 三元表达式 → <code>Conditional</code></li>
                    <li>for / while / forEach / map → <code>Loop</code></li>
                  </ul>
                  <p>忽略样式属性、变量名、字面量值。</p>
                  <div className="step-data">
                    代码A 提取签名数: <strong>{diffResult.astStructureDebug.oldSignatureCount}</strong>{' | '}
                    代码B 提取签名数: <strong>{diffResult.astStructureDebug.newSignatureCount}</strong>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 3: 多重集签名比较</div>
                <div className="step-desc-block">
                  <p>
                    将两份代码的结构签名按类型逐一比较（忽略顺序）。
                    对每种签名类型，匹配数取两边的较小值，总数取两边的较大值，最后汇总:
                  </p>
                  <div className="step-formula">
                    相似度 = 各类型匹配数之和 / 各类型较大值之和 × 100%
                  </div>
                  <div className="step-data">
                    匹配数之和: <strong>{diffResult.astStructureDebug.matchedCount}</strong>{' | '}
                    较大值之和: <strong>{diffResult.astStructureDebug.totalCount}</strong>
                  </div>
                  <div className="step-formula">
                    {diffResult.astStructureDebug.matchedCount} / {diffResult.astStructureDebug.totalCount} × 100% = {diffResult.astStructureSimilarity.toFixed(2)}%
                  </div>
                  <div className="step-result">
                    <span className="result-label">最终得分</span>
                    <Tag color="blue" style={{ fontSize: 16, fontWeight: 700, padding: '2px 12px' }}>
                      {diffResult.astStructureSimilarity.toFixed(2)}%
                    </Tag>
                  </div>
                </div>
              </div>
              {diffResult.astStructureChanges.length > 0 && (
                <>
                  <Divider />
                  <div className="drawer-diff-section">
                    <div className="drawer-diff-title">
                      检测到的结构差异（{diffResult.astStructureChanges.length} 项）
                    </div>
                    <ul className="step-list">
                      {diffResult.astStructureChanges.slice(0, 20).map((c, i) => (
                        <li key={i} className={c.type === 'added' ? 'item-added' : 'item-removed'}>
                          {c.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ---------- 语义相似度 ---------- */}
        {detailPanel === 'semantic' && modelSimilarity && (
          <div className="drawer-detail-panel">
            <Steps
              current={3}
              size="small"
              className="drawer-h-steps"
              labelPlacement="vertical"
              items={[
                { title: '后端代码预处理', status: 'finish' },
                { title: 'DFG 数据流图提取', status: 'finish' },
                { title: 'GraphCodeBERT 编码', status: 'finish' },
                { title: '校准余弦相似度', status: 'finish' },
              ]}
            />
            <div className="drawer-step-content">
              <div className="step-section">
                <div className="step-section-title">步骤 1: 后端代码预处理</div>
                <div className="step-desc-block">
                  <p>去除注释和文档字符串，使用 tree-sitter 将代码解析为 AST。</p>
                  {modelSimilarity.code1_analysis && modelSimilarity.code2_analysis && (
                    <div className="step-data">
                      代码A token 数: <strong>{modelSimilarity.code1_analysis.token_count}</strong>{' | '}
                      代码B token 数: <strong>{modelSimilarity.code2_analysis.token_count}</strong>
                    </div>
                  )}
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 2: DFG 数据流图提取</div>
                <div className="step-desc-block">
                  <p>
                    从 AST 中提取变量间的数据流依赖关系（comesFrom / computedFrom），
                    例如 y = x 则 y comesFrom x，z = x + y 则 z computedFrom x, y。
                  </p>
                  {modelSimilarity.code1_analysis && modelSimilarity.code2_analysis && (
                    <div className="step-data">
                      代码A DFG 边数: <strong>{modelSimilarity.code1_analysis.dfg_edges}</strong>{' | '}
                      代码B DFG 边数: <strong>{modelSimilarity.code2_analysis.dfg_edges}</strong>
                    </div>
                  )}
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 3: GraphCodeBERT 编码</div>
                <div className="step-desc-block">
                  <p>
                    将「代码 token + DFG 关系字符串」拼接后输入 GraphCodeBERT 模型，
                    取 0.7 × [CLS] + 0.3 × MeanPooling 得到 768 维语义向量。
                  </p>
                  <div className="step-data">
                    向量维度: <strong>768</strong>{' | '}
                    模型: <strong>graphcodebert-base</strong>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 4: 校准余弦相似度</div>
                <div className="step-desc-block">
                  <p>
                    先算原始余弦相似度 cos_sim，再算文本 Jaccard 相似度 text_sim（token 集合交并比），
                    最终结果:
                  </p>
                  <div className="step-formula">
                    similarity = sqrt(cos_sim × text_sim)
                  </div>
                  {modelSimilarity.raw_cosine_similarity != null && (
                    <div className="step-data">
                      原始余弦相似度 (cos_sim): <strong>{modelSimilarity.raw_cosine_similarity.toFixed(6)}</strong>
                    </div>
                  )}
                  {modelSimilarity.text_similarity != null && (
                    <div className="step-data">
                      文本 Jaccard 相似度 (text_sim): <strong>{modelSimilarity.text_similarity.toFixed(6)}</strong>
                    </div>
                  )}
                  {modelSimilarity.raw_cosine_similarity != null && modelSimilarity.text_similarity != null && (
                    <div className="step-formula">
                      sqrt({modelSimilarity.raw_cosine_similarity.toFixed(4)} × {modelSimilarity.text_similarity.toFixed(4)}) = {modelSimilarity.similarity.toFixed(6)}
                    </div>
                  )}
                  {modelSimilarity.text_similarity != null && modelSimilarity.text_similarity < 0.3 && (
                    <div className="step-data" style={{ color: '#e65100' }}>
                      text_sim &lt; 0.3，触发额外惩罚: × ({(0.5 + modelSimilarity.text_similarity).toFixed(4)})
                    </div>
                  )}
                  <div className="step-result">
                    <span className="result-label">最终得分</span>
                    <Tag color="blue" style={{ fontSize: 16, fontWeight: 700, padding: '2px 12px' }}>
                      {modelSimilarity.similarity_percent.toFixed(2)}%
                    </Tag>
                    <Tag color="gray">{modelSimilarity.interpretation}</Tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

// ========================================================================
// 辅助类型和函数
// ========================================================================

interface LineData {
  lineNumber: number | null;
  content: string;
  type: 'normal' | 'added' | 'removed' | 'empty';
  marker: string;
}

const normalizeLine = (s: string) => {
  let normalized = s.trim().replace(/\s+/g, ' ');
  // useMemo/useCallback 依赖数组结束: ], []); → ];
  normalized = normalized.replace(/\],\s*\[[^\]]*\]\s*\);?\s*$/, '];');
  normalized = normalized.replace(/\},\s*\[[^\]]*\]\s*\);?\s*$/, '};');
  return normalized;
};
const normalizeStripAllWs = (s: string) => s.replace(/\s/g, '');

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
 */
const normalizeToPattern = (s: string): string => {
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
  
  const loopEquivalentMethods = new Set([
    'forEach', 'map', 'filter', 'reduce', 'reduceRight',
    'find', 'findIndex', 'some', 'every', 'flatMap'
  ]);
  
  let normalized = s.trim().replace(/\s+/g, ' ');
  
  // 统一 TypeScript 数组类型写法: Array<T> → T[]
  normalized = normalized.replace(/Array<([^>]+)>/g, '$1[]');
  
  // React Fragment 和 div 等价: <></>, <React.Fragment>, <Fragment> 统一为 <_CONTAINER_>
  normalized = normalized.replace(/<>|<React\.Fragment>|<Fragment>/g, '<_CONTAINER_>');
  normalized = normalized.replace(/<\/>|<\/React\.Fragment>|<\/Fragment>/g, '</_CONTAINER_>');
  normalized = normalized.replace(/<div(\s[^>]*)?>|<div>/g, '<_CONTAINER_>');
  normalized = normalized.replace(/<\/div>/g, '</_CONTAINER_>');
  
  // 移除 TypeScript 类型注解
  normalized = normalized.replace(/:\s*[A-Za-z_$][A-Za-z0-9_$<>\[\],\s|&]*(?=\s*[=,)\]])/g, '');
  
  // 移除 React Hooks 包装
  normalized = normalized.replace(/=\s*useMemo\s*\(\s*\(\)\s*=>\s*/g, '= ');
  normalized = normalized.replace(/=\s*useCallback\s*\(\s*/g, '= ');
  
  // useMemo/useCallback 的依赖数组结束部分: ], []); 或 }, []); 等价于 ]; 或 };
  normalized = normalized.replace(/\],\s*\[[^\]]*\]\s*\);?\s*$/g, '];');
  normalized = normalized.replace(/\},\s*\[[^\]]*\]\s*\);?\s*$/g, '};');
  
  // 统一函数声明形式
  normalized = normalized.replace(/\bfunction\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*function\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*\(/g, '_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*async\s+function\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  normalized = normalized.replace(/\b(const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*async\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  normalized = normalized.replace(/\basync\s+function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/g, '_ASYNC_FUNC_DECL_ (');
  
  // 统一循环形式
  normalized = normalized.replace(/\bfor\s*\(/g, '_LOOP_ (');
  normalized = normalized.replace(/\bwhile\s*\(/g, '_LOOP_ (');
  normalized = normalized.replace(/\bdo\s*\{/g, '_LOOP_ {');
  
  // 统一条件形式
  normalized = normalized.replace(/\bif\s*\(/g, '_COND_ (');
  
  // 忽略样式属性的值
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
  
  // 变量声明
  normalized = normalized.replace(/\b(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '$1 _ID_');
  
  // 函数参数声明
  normalized = normalized.replace(/\(([^)]*)\)\s*(=>|{)/g, (_match, params, arrow) => {
    const normalizedParams = params.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::|,|\))/g, (m: string, id: string) => {
      if (keywords.has(id)) return m;
      return m.replace(id, '_ID_');
    });
    return `(${normalizedParams}) ${arrow}`;
  });
  
  // 统一循环等价的数组方法
  for (const method of loopEquivalentMethods) {
    const methodPattern = new RegExp(`\\.${method}\\s*\\(`, 'g');
    normalized = normalized.replace(methodPattern, '._LOOP_METHOD_(');
  }
  
  // 函数调用的参数值
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
 * 将「仅位置/格式不同、内容等价」的删除行与新增行配对
 */
function markMovedLinesAsUnchanged(
  leftLines: LineData[],
  rightLines: LineData[]
): void {
  const matchedLeft = new Set<number>();
  const matchedRight = new Set<number>();

  // 策略0：空行匹配
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

  // 策略1：按「规范化行」逐行匹配
  const removedByNorm = new Map<string, number[]>();
  const addedByNorm = new Map<string, number[]>();
  
  for (let i = 0; i < leftLines.length; i++) {
    if (matchedLeft.has(i) || leftLines[i].type !== 'removed' || leftLines[i].content.trim() === '') continue;
    const key = normalizeLine(leftLines[i].content);
    if (!removedByNorm.has(key)) removedByNorm.set(key, []);
    removedByNorm.get(key)!.push(i);
  }
  
  for (let j = 0; j < rightLines.length; j++) {
    if (matchedRight.has(j) || rightLines[j].type !== 'added' || rightLines[j].content.trim() === '') continue;
    const key = normalizeLine(rightLines[j].content);
    if (!addedByNorm.has(key)) addedByNorm.set(key, []);
    addedByNorm.get(key)!.push(j);
  }
  
  removedByNorm.forEach((leftIndices, key) => {
    const rightIndices = addedByNorm.get(key);
    if (!rightIndices) return;
    
    const n = Math.min(leftIndices.length, rightIndices.length);
    for (let k = 0; k < n; k++) {
      const i = leftIndices[k];
      const j = rightIndices[k];
      
      matchedLeft.add(i);
      matchedRight.add(j);
      leftLines[i].type = 'normal';
      leftLines[i].marker = '';
      rightLines[j].type = 'normal';
      rightLines[j].marker = '';
    }
  });

  // 策略1.5：按「结构模式」匹配
  const removedByPattern = new Map<string, number[]>();
  const addedByPattern = new Map<string, number[]>();
  
  for (let i = 0; i < leftLines.length; i++) {
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
  
  removedByPattern.forEach((leftIndices, pattern) => {
    const rightIndices = addedByPattern.get(pattern);
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

  // 策略1.6：JSX 标签顺序匹配
  const normalizeJSXAttributes = (s: string): string => {
    const jsxMatch = s.match(/^(\s*<\/?[\w.]+)\s*(.*?)(\/?>?\s*)$/);
    if (!jsxMatch) return normalizeToPattern(s);
    
    const [, tagStart, attrsStr, tagEnd] = jsxMatch;
    
    const attrs: string[] = [];
    const attrRegex = /(\w+)(?:=(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^\s>]+))?/g;
    let match;
    while ((match = attrRegex.exec(attrsStr)) !== null) {
      const attrName = match[1];
      if (IGNORED_STYLE_ATTRIBUTES.has(attrName)) {
        attrs.push(`${attrName}=_STYLE_`);
      } else {
        attrs.push(normalizeToPattern(match[0]));
      }
    }
    
    attrs.sort();
    
    return `${normalizeToPattern(tagStart)} ${attrs.join(' ')} ${tagEnd.trim()}`;
  };
  
  const removedByJSX = new Map<string, number[]>();
  const addedByJSX = new Map<string, number[]>();
  
  for (let i = 0; i < leftLines.length; i++) {
    if (matchedLeft.has(i) || leftLines[i].type !== 'removed') continue;
    const content = leftLines[i].content.trim();
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

  // 策略2：块匹配 - 多行删除 vs 单行新增
  const removedOrdered = leftLines
    .map((_, i) => i)
    .filter((i) => leftLines[i].type === 'removed' && !matchedLeft.has(i));
  
  for (let j = 0; j < rightLines.length; j++) {
    if (rightLines[j].type !== 'added' || matchedRight.has(j)) continue;
    
    const R = normalizeStripAllWs(rightLines[j].content);
    if (R === '') continue;
    
    for (let start = 0; start < removedOrdered.length; start++) {
      if (matchedLeft.has(removedOrdered[start])) continue;
      
      let concat = '';
      const used: number[] = [];
      
      for (let len = 1; start + len <= removedOrdered.length; len++) {
        const idx = removedOrdered[start + len - 1];
        if (matchedLeft.has(idx)) break;
        
        concat += normalizeStripAllWs(leftLines[idx].content);
        used.push(idx);
        
        if (concat === R) {
          used.forEach((i) => {
            matchedLeft.add(i);
            leftLines[i].type = 'normal';
            leftLines[i].marker = '';
          });
          matchedRight.add(j);
          rightLines[j].type = 'normal';
          rightLines[j].marker = '';
          break;
        }
        
        if (concat.length >= R.length) break;
      }
      
      if (matchedRight.has(j)) break;
    }
  }

  // 策略3：块匹配 - 单行删除 vs 多行新增
  const addedOrdered = rightLines
    .map((_, j) => j)
    .filter((j) => rightLines[j].type === 'added' && !matchedRight.has(j));
  
  for (let i = 0; i < leftLines.length; i++) {
    if (leftLines[i].type !== 'removed' || matchedLeft.has(i)) continue;
    
    const L = normalizeStripAllWs(leftLines[i].content);
    if (L === '') continue;
    
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
 */
function buildSideBySideView(oldCode: string, newCode: string, changes: any[]) {
  const leftLines: LineData[] = [];
  const rightLines: LineData[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const lines = change.value.split('\n');
    
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (change.removed) {
      for (const line of lines) {
        leftLines.push({
          lineNumber: oldLineNum++,
          content: line,
          type: 'removed',
          marker: '-',
        });
        rightLines.push({
          lineNumber: null,
          content: '',
          type: 'empty',
          marker: '',
        });
      }
    } else if (change.added) {
      for (const line of lines) {
        leftLines.push({
          lineNumber: null,
          content: '',
          type: 'empty',
          marker: '',
        });
        rightLines.push({
          lineNumber: newLineNum++,
          content: line,
          type: 'added',
          marker: '+',
        });
      }
    } else {
      for (const line of lines) {
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

  markMovedLinesAsUnchanged(leftLines, rightLines);
  
  return { leftLines, rightLines };
}

function getChangeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    added: '新增',
    removed: '移除',
    modified: '修改',
  };
  return labels[type] || type;
}

export default CodeDiffViewer;
