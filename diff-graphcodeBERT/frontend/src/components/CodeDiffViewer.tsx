// ========================================================================
// components/CodeDiffViewer.tsx
// 代码对比视图组件 - AST + GraphCodeBERT 版本
// ========================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { diffLines, Change } from 'diff';
import { DiffResult } from '../utils/ASTDiffAnalyzer';
import { Drawer, Button, Tag, Steps, Divider, Spin, Tooltip, Table } from 'antd';
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

import { HierarchicalCompareResponse } from '../App';

/**
 * 组件属性接口定义
 */
interface CodeDiffViewerProps {
  oldCode: string;
  newCode: string;
  oldFileName: string;
  newFileName: string;
  diffResult: DiffResult;
  hierarchicalResult: HierarchicalCompareResponse | null;
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
  hierarchicalResult,
  onBack,
}) => {
  // 折叠状态
  const [collapsed, setCollapsed] = useState(false);
  // 当前打开的详情面板: null | 'ast-structure' | 'semantic'
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

        {/* 综合语义相似度（函数级分层编码） */}
        {hierarchicalResult && (
          <div className="file-info model-similarity-row">
            <Tooltip title="将代码拆分为小单元，提取DFG数据流图，使用 GraphCodeBERT 独立编码并进行匈牙利算法最优匹配">
              <span className="label">综合语义相似度:</span>
            </Tooltip>
            <span className={`ast-vector-value ${hierarchicalResult.similarity >= 0.85 ? 'high' : hierarchicalResult.similarity >= 0.5 ? 'medium' : 'low'}`}>
              {hierarchicalResult.similarity_percent.toFixed(2)}%
            </span>
            <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>
              {hierarchicalResult.matches.length} 对匹配
            </Tag>
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
          detailPanel === 'ast-structure'
            ? 'AST 结构相似度 — 计算过程'
            : '综合语义相似度 — 计算过程'
        }
        onClose={() => setDetailPanel(null)}
        maskClosable
        closable
      >
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

        {/* ---------- 综合语义相似度 ---------- */}
        {detailPanel === 'semantic' && hierarchicalResult && (
          <div className="drawer-detail-panel">
            <Steps
              current={3}
              size="small"
              className="drawer-h-steps"
              labelPlacement="vertical"
              items={[
                { title: 'Tree-sitter 精确拆分', status: 'finish' },
                { title: 'DFG 提取与向量编码', status: 'finish' },
                { title: '匈牙利算法最优匹配', status: 'finish' },
              ]}
            />
            <div className="drawer-step-content">
              <div className="step-section">
                <div className="step-section-title">步骤 1: Tree-sitter 精确拆分（后端）</div>
                <div className="step-desc-block">
                  <p>
                    使用 Tree-sitter 解析器在后端将代码拆分为函数、组件、Hooks、变量等语义单元。
                    Tree-sitter 生成 CST（具体语法树），保留所有源代码细节，确保不丢失任何代码。
                  </p>
                  <div className="step-data">
                    代码A 拆分单元数: <strong>{hierarchicalResult.units1?.length || 0}</strong>{' | '}
                    代码B 拆分单元数: <strong>{hierarchicalResult.units2?.length || 0}</strong>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 2: DFG 提取与向量编码（后端）</div>
                <div className="step-desc-block">
                  <p>
                    对每个拆分后的小单元，使用 Tree-sitter 提取其内部的 DFG（数据流图），
                    记录变量之间的"值从何处来"的依赖关系。
                  </p>
                  <p>
                    然后将 <code>代码 + DFG</code> 一起送入 GraphCodeBERT 模型编码为 768 维向量。
                    如果 token 数超过 512，会智能截断：优先保留完整代码，压缩 DFG。
                  </p>
                  <div className="step-data">
                    代码A单元数: <strong>{hierarchicalResult.encoding_details_a?.length || 0}</strong>{' | '}
                    代码B单元数: <strong>{hierarchicalResult.encoding_details_b?.length || 0}</strong>
                  </div>
                </div>
              </div>
              <Divider />
              <div className="step-section">
                <div className="step-section-title">步骤 3: 匈牙利算法最优匹配</div>
                <div className="step-desc-block">
                  <p>
                    <strong>匈牙利算法（Hungarian Algorithm）</strong>是一种在多项式时间内求解二分图最大权匹配问题的组合优化算法。
                    在代码相似度检测中，我们用它来找到两组代码单元之间的<strong>全局最优一对一匹配</strong>。
                  </p>
                  
                  <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, marginTop: 12, marginBottom: 12 }}>
                    <strong>核心步骤：</strong>
                    <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
                      <li>构建相似度矩阵（所有单元两两计算余弦相似度）</li>
                      <li><strong>类型隔离</strong>：imports 只能和 imports 匹配，不同类型相似度设为 0</li>
                      <li><strong>imports 精确匹配</strong>：使用 Jaccard 相似度（导入标识符的集合重叠度）</li>
                      <li>转换为代价矩阵（代价 = 1 - 相似度）</li>
                      <li>匈牙利算法求解（找到总代价最小 = 总相似度最大的匹配）</li>
                      <li><strong>过滤低相似度</strong>：相似度 &lt; 30% 的匹配视为无效，标记为"未匹配"</li>
                      <li>按行数加权平均，计算最终相似度</li>
                    </ol>
                  </div>
                  
                  <div className="step-data">
                    成功匹配: <strong>{hierarchicalResult.matches.length}</strong> 对{' | '}
                    代码A未匹配: <strong>{hierarchicalResult.unmatched_a.length}</strong> 个{' | '}
                    代码B未匹配: <strong>{hierarchicalResult.unmatched_b.length}</strong> 个
                  </div>
                  <div className="step-result">
                    <span className="result-label">最终得分</span>
                    <Tag color="blue" style={{ fontSize: 16, fontWeight: 700, padding: '2px 12px' }}>
                      {hierarchicalResult.similarity_percent.toFixed(2)}%
                    </Tag>
                    <Tag color="gray">{hierarchicalResult.interpretation}</Tag>
                  </div>
                </div>
              </div>

              {/* 3.1 相似度矩阵热力图 */}
              <Divider />
              <div className="step-section">
                <div className="step-section-title">3.1 相似度矩阵热力图</div>
                <div className="step-desc-block">
                  <p style={{ fontSize: 13, color: '#666' }}>
                    矩阵展示了所有单元之间的相似度。<strong>红色边框 + ✓</strong> 标记的是匈牙利算法选中的最优匹配对。
                  </p>
                  
                  {(!hierarchicalResult.similarity_matrix || !hierarchicalResult.unit_names_a || !hierarchicalResult.unit_names_b) ? (
                    <div style={{ padding: 16, background: '#fff1f0', border: '1px solid #ffccc7', borderRadius: 4, marginTop: 16 }}>
                      <strong>数据缺失：</strong>
                      <ul>
                        <li>similarity_matrix: {hierarchicalResult.similarity_matrix ? '✓' : '✗'}</li>
                        <li>unit_names_a: {hierarchicalResult.unit_names_a ? '✓' : '✗'}</li>
                        <li>unit_names_b: {hierarchicalResult.unit_names_b ? '✓' : '✗'}</li>
                      </ul>
                    </div>
                  ) : (
                    <>
                    <div style={{ marginTop: 16, marginBottom: 12 }}>
                      <span style={{ color: '#595959' }}>矩阵大小: </span>
                      <strong>{hierarchicalResult.unit_names_a.length} × {hierarchicalResult.unit_names_b.length}</strong>
                    </div>
                    <Table
                      dataSource={hierarchicalResult.unit_names_a.map((nameA, i) => {
                        const rowData: any = {
                          key: i,
                          unitName: nameA
                        };
                        hierarchicalResult.unit_names_b.forEach((nameB, j) => {
                          rowData[`col_${j}`] = {
                            similarity: hierarchicalResult.similarity_matrix[i]?.[j] || 0,
                            isMatched: hierarchicalResult.matches.some(m => m.unit_a === nameA && m.unit_b === nameB)
                          };
                        });
                        return rowData;
                      })}
                      columns={[
                        {
                          title: '代码A \\ 代码B',
                          dataIndex: 'unitName',
                          key: 'unitName',
                          fixed: 'left' as const,
                          width: 200,
                          ellipsis: { showTitle: true },
                          render: (name: string) => (
                            <Tooltip title={name}>
                              <span style={{ fontWeight: 600 }}>{name}</span>
                            </Tooltip>
                          )
                        },
                        ...hierarchicalResult.unit_names_b.map((nameB, j) => ({
                          title: <Tooltip title={nameB}>{nameB.length > 15 ? nameB.substring(0, 15) + '...' : nameB}</Tooltip>,
                          dataIndex: `col_${j}`,
                          key: `col_${j}`,
                          width: 100,
                          align: 'center' as const,
                          render: (cell: { similarity: number; isMatched: boolean }) => {
                            const sim = cell.similarity;
                            const isMatched = cell.isMatched;
                            const percentage = (sim * 100).toFixed(0);
                            
                            const getColor = (s: number) => {
                              if (s >= 0.9) return { bg: '#0050b3', text: '#fff' };
                              if (s >= 0.8) return { bg: '#1890ff', text: '#fff' };
                              if (s >= 0.7) return { bg: '#40a9ff', text: '#fff' };
                              if (s >= 0.6) return { bg: '#69c0ff', text: '#000' };
                              if (s >= 0.5) return { bg: '#91d5ff', text: '#000' };
                              if (s >= 0.4) return { bg: '#bae7ff', text: '#000' };
                              if (s >= 0.3) return { bg: '#e6f7ff', text: '#000' };
                              return { bg: '#fff', text: '#bfbfbf' };
                            };

                            const colors = getColor(sim);

                            return (
                              <div style={{ 
                                background: isMatched ? '#fff2e8' : colors.bg,
                                color: isMatched ? '#ff4d4f' : colors.text,
                                padding: isMatched ? '5px' : '8px',
                                margin: isMatched ? '-8px' : '-8px',
                                fontWeight: isMatched ? 700 : 600,
                                fontSize: isMatched ? 14 : 13,
                                border: isMatched ? '3px solid #ff4d4f' : 'none',
                                borderRadius: isMatched ? 4 : 0,
                                boxSizing: 'border-box' as const,
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column' as const,
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}>
                                <div>{percentage}%</div>
                              </div>
                            );
                          }
                        }))
                      ]}
                      pagination={false}
                      scroll={{ x: 'max-content', y: 600 }}
                      size="small"
                      bordered
                    />
                    </>
                  )}
                  
                <div style={{ marginTop: 20 }}>
                  <Divider orientation="left">图例说明</Divider>
                  
                  <Table
                    dataSource={[
                      { key: '1', range: '90% - 100%', color: '#0050b3', desc: '极高相似', textColor: '#fff' },
                      { key: '2', range: '80% - 90%', color: '#1890ff', desc: '高度相似', textColor: '#fff' },
                      { key: '3', range: '70% - 80%', color: '#40a9ff', desc: '较为相似', textColor: '#fff' },
                      { key: '4', range: '60% - 70%', color: '#69c0ff', desc: '中上相似', textColor: '#000' },
                      { key: '5', range: '50% - 60%', color: '#91d5ff', desc: '中等相似', textColor: '#000' },
                      { key: '6', range: '40% - 50%', color: '#bae7ff', desc: '偏低相似', textColor: '#000' },
                      { key: '7', range: '30% - 40%', color: '#e6f7ff', desc: '低相似度', textColor: '#000' },
                      { key: '8', range: '< 30%', color: '#fff', desc: '几乎不同', textColor: '#bfbfbf' }
                    ]}
                    columns={[
                      {
                        title: '相似度范围',
                        dataIndex: 'range',
                        key: 'range',
                        width: 150,
                        align: 'center' as const
                      },
                      {
                        title: '颜色示例',
                        dataIndex: 'color',
                        key: 'color',
                        width: 120,
                        align: 'center' as const,
                        render: (color: string, record: any) => (
                          <div style={{ 
                            background: color,
                            color: record.textColor,
                            padding: '8px 16px',
                            borderRadius: 4,
                            fontWeight: 600,
                            fontSize: 13
                          }}>
                            {record.range.split(' - ')[0]}
                          </div>
                        )
                      },
                      {
                        title: '说明',
                        dataIndex: 'desc',
                        key: 'desc',
                        align: 'center' as const
                      }
                    ]}
                    pagination={false}
                    size="small"
                    style={{ marginBottom: 16 }}
                  />

                  <Table
                    dataSource={[
                      { 
                        key: 'matched', 
                        mark: '✓', 
                        desc: '匈牙利算法选中的匹配',
                        style: '红色边框 + 橙色背景'
                      }
                    ]}
                    columns={[
                      {
                        title: '标记',
                        dataIndex: 'mark',
                        key: 'mark',
                        width: 80,
                        align: 'center' as const,
                        render: (mark: string) => (
                          <div style={{ fontSize: 24, color: '#ff4d4f', fontWeight: 700 }}>
                            {mark}
                          </div>
                        )
                      },
                      {
                        title: '说明',
                        dataIndex: 'desc',
                        key: 'desc'
                      },
                      {
                        title: '视觉样式',
                        dataIndex: 'style',
                        key: 'style',
                        align: 'center' as const
                      }
                    ]}
                    pagination={false}
                    size="small"
                    style={{ marginBottom: 16 }}
                  />

                  <div style={{ 
                    padding: 12, 
                    background: '#fffbe6', 
                    borderRadius: 4,
                    border: '1px solid #ffe58f'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>匹配规则</div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                      <li>相似度 &lt; 30% 的匹配会被自动过滤</li>
                      <li><code>imports</code> 类型只能与 <code>imports</code> 匹配</li>
                      <li>使用 Jaccard 相似度精确匹配 import 语句</li>
                    </ul>
                  </div>
                </div>
                </div>
              </div>

              {/* 3.2 综合相似度计算过程 */}
              <Divider />
              <div className="step-section">
                <div className="step-section-title">3.2 综合相似度计算过程（加权平均）</div>
                <div className="step-desc-block">
                  <p>
                    <strong>计算公式：</strong>
                  </p>
                  <div style={{ 
                    background: '#f5f5f5', 
                    padding: 16, 
                    borderRadius: 4, 
                    fontFamily: 'monospace',
                    fontSize: 14,
                    marginTop: 8,
                    marginBottom: 16
                  }}>
                    综合相似度 = Σ(相似度 × 权重) / Σ(权重)
                    <br />
                    <br />
                    权重 = (代码A行数 + 代码B行数) / 2
                  </div>

                  <p><strong>详细计算：</strong></p>
                  <div style={{ fontSize: 13, marginTop: 16 }}>
                    {/* 匹配的单元 */}
                    {hierarchicalResult.matches.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ 
                          fontWeight: 600, 
                          color: '#52c41a', 
                          marginBottom: 12,
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <span style={{ fontSize: 18 }}>✓</span>
                          匹配的单元（贡献相似度）
                        </div>
                        <Table
                          dataSource={hierarchicalResult.matches.map((match, idx) => ({
                            key: idx,
                            unit_a: match.unit_a,
                            unit_b: match.unit_b,
                            similarity: match.similarity,
                            lines_a: match.lines_a,
                            lines_b: match.lines_b,
                            weight: match.weight,
                            contribution: match.similarity * match.weight
                          }))}
                          columns={[
                            {
                              title: '单元匹配',
                              dataIndex: 'unit_a',
                              key: 'match',
                              render: (_: any, record: any) => (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ color: '#1890ff' }}>→</span>
                                  <span style={{ wordBreak: 'break-word' }}>
                                    {record.unit_a} <span style={{ color: '#999' }}>↔</span> {record.unit_b}
                                  </span>
                                </div>
                              )
                            },
                            {
                              title: '相似度',
                              dataIndex: 'similarity',
                              key: 'similarity',
                              width: 100,
                              align: 'center' as const,
                              render: (sim: number) => (
                                <span style={{ 
                                  fontWeight: 600,
                                  color: sim >= 0.8 ? '#52c41a' : sim >= 0.5 ? '#1890ff' : '#666'
                                }}>
                                  {(sim * 100).toFixed(1)}%
                                </span>
                              )
                            },
                            {
                              title: '行数A',
                              dataIndex: 'lines_a',
                              key: 'lines_a',
                              width: 80,
                              align: 'center' as const
                            },
                            {
                              title: '行数B',
                              dataIndex: 'lines_b',
                              key: 'lines_b',
                              width: 80,
                              align: 'center' as const
                            },
                            {
                              title: '权重',
                              dataIndex: 'weight',
                              key: 'weight',
                              width: 80,
                              align: 'center' as const,
                              render: (weight: number) => (
                                <span style={{ fontWeight: 600 }}>{weight}</span>
                              )
                            },
                            {
                              title: '贡献计算',
                              dataIndex: 'contribution',
                              key: 'contribution',
                              width: 220,
                              align: 'right' as const,
                              render: (_: any, record: any) => (
                                <span style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: 11 }}>
                                  <span style={{ color: '#666' }}>{record.similarity.toFixed(4)}</span>
                                  <span style={{ color: '#999', margin: '0 4px' }}>×</span>
                                  <span style={{ color: '#666' }}>{record.weight}</span>
                                  <span style={{ color: '#999', margin: '0 4px' }}>=</span>
                                  <span style={{ fontWeight: 600, color: '#1890ff' }}>{record.contribution.toFixed(2)}</span>
                                </span>
                              )
                            }
                          ]}
                          pagination={false}
                          size="small"
                          bordered
                          summary={() => (
                            <Table.Summary fixed>
                              <Table.Summary.Row style={{ background: 'linear-gradient(180deg, #e6f7ff 0%, #bae7ff 100%)' }}>
                                <Table.Summary.Cell index={0} colSpan={5} align="right">
                                  <span style={{ fontWeight: 600, fontSize: 13, color: '#0050b3' }}>
                                    匹配单元总贡献：
                                  </span>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={1} align="right">
                                  <span style={{ 
                                    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                                    fontSize: 14,
                                    fontWeight: 700,
                                    color: '#0050b3'
                                  }}>
                                    {hierarchicalResult.matches.reduce((sum, m) => sum + m.similarity * m.weight, 0).toFixed(2)}
                                  </span>
                                </Table.Summary.Cell>
                              </Table.Summary.Row>
                            </Table.Summary>
                          )}
                        />
                      </div>
                    )}

                    {/* 未匹配的单元 */}
                    {(hierarchicalResult.unmatched_a.length > 0 || hierarchicalResult.unmatched_b.length > 0) && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ 
                          fontWeight: 600, 
                          color: '#ff4d4f', 
                          marginBottom: 12,
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <span style={{ fontSize: 18 }}>✗</span>
                          未匹配的单元（相似度 = 0，但权重计入）
                        </div>
                        <Table
                          dataSource={[
                            ...hierarchicalResult.unmatched_a.map((name, idx) => {
                              const unit = hierarchicalResult.units1?.find(u => u.name === name);
                              return {
                                key: `a-${idx}`,
                                name,
                                source: 'A',
                                lines: unit?.lineCount || 0
                              };
                            }),
                            ...hierarchicalResult.unmatched_b.map((name, idx) => {
                              const unit = hierarchicalResult.units2?.find(u => u.name === name);
                              return {
                                key: `b-${idx}`,
                                name,
                                source: 'B',
                                lines: unit?.lineCount || 0
                              };
                            })
                          ]}
                          columns={[
                            {
                              title: '单元名称',
                              dataIndex: 'name',
                              key: 'name'
                            },
                            {
                              title: '来源',
                              dataIndex: 'source',
                              key: 'source',
                              width: 100,
                              align: 'center' as const,
                              render: (source: string) => (
                                <Tag color={source === 'A' ? 'red' : 'green'} style={{ margin: 0, fontSize: 11 }}>
                                  代码{source}
                                </Tag>
                              )
                            },
                            {
                              title: '行数',
                              dataIndex: 'lines',
                              key: 'lines',
                              width: 80,
                              align: 'center' as const
                            },
                            {
                              title: '贡献',
                              dataIndex: 'lines',
                              key: 'contribution',
                              width: 150,
                              align: 'right' as const,
                              render: (lines: number) => (
                                <span style={{ 
                                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                                  fontSize: 11,
                                  color: '#999'
                                }}>
                                  0 × {lines} = 0.00
                                </span>
                              )
                            }
                          ]}
                          pagination={false}
                          size="small"
                          bordered
                          summary={() => (
                            <Table.Summary fixed>
                              <Table.Summary.Row style={{ background: 'linear-gradient(180deg, #fff1f0 0%, #ffccc7 100%)' }}>
                                <Table.Summary.Cell index={0} colSpan={3} align="right">
                                  <span style={{ fontWeight: 600, fontSize: 13, color: '#cf1322' }}>
                                    未匹配单元总贡献：
                                  </span>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={1} align="right">
                                  <span style={{ 
                                    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                                    fontSize: 14,
                                    fontWeight: 700,
                                    color: '#cf1322'
                                  }}>
                                    0.00
                                  </span>
                                </Table.Summary.Cell>
                              </Table.Summary.Row>
                            </Table.Summary>
                          )}
                        />
                      </div>
                    )}

                    {/* 最终计算 */}
                    <div style={{ 
                      background: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%)', 
                      padding: 24, 
                      borderRadius: 8,
                      border: '3px solid #1890ff',
                      boxShadow: '0 4px 12px rgba(24, 144, 255, 0.15)'
                    }}>
                      <div style={{ 
                        fontWeight: 700, 
                        fontSize: 16, 
                        marginBottom: 16, 
                        color: '#0050b3',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}>
                        <span style={{ fontSize: 20 }}>🧮</span>
                        最终计算
                      </div>
                      <div style={{ 
                        fontFamily: 'Menlo, Monaco, "Courier New", monospace', 
                        fontSize: 14, 
                        lineHeight: 2,
                        background: '#fff',
                        padding: 16,
                        borderRadius: 4,
                        border: '1px solid #91d5ff'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#595959' }}>总加权相似度</span>
                          <span style={{ fontWeight: 600, color: '#1890ff', fontSize: 15 }}>
                            {hierarchicalResult.matches.reduce((sum, m) => sum + m.similarity * m.weight, 0).toFixed(2)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#595959' }}>总权重</span>
                          <span style={{ fontWeight: 600, color: '#1890ff', fontSize: 15 }}>
                            {hierarchicalResult.total_weight?.toFixed(1) || 'N/A'}
                          </span>
                        </div>
                        <div style={{ 
                          marginTop: 12, 
                          paddingTop: 12, 
                          borderTop: '2px solid #1890ff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'linear-gradient(90deg, #f0f9ff 0%, #e6f7ff 100%)',
                          padding: '12px 16px',
                          borderRadius: 4,
                          marginLeft: -16,
                          marginRight: -16,
                          marginBottom: -16
                        }}>
                          <span style={{ color: '#0050b3', fontWeight: 700, fontSize: 15 }}>
                            综合相似度
                          </span>
                          <span style={{ fontWeight: 700, color: '#0050b3', fontSize: 18 }}>
                            {hierarchicalResult.matches.reduce((sum, m) => sum + m.similarity * m.weight, 0).toFixed(2)} ÷ {hierarchicalResult.total_weight?.toFixed(1) || 'N/A'} = <span style={{ fontSize: 22, color: '#1890ff' }}>{hierarchicalResult.similarity_percent.toFixed(2)}%</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ 
                    marginTop: 20, 
                    padding: 16, 
                    background: 'linear-gradient(135deg, #fffbe6 0%, #fff7cc 100%)', 
                    border: '2px solid #faad14', 
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(250, 173, 20, 0.1)'
                  }}>
                    <div style={{ 
                      fontWeight: 600, 
                      fontSize: 14, 
                      color: '#d48806',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8
                    }}>
                      <span style={{ fontSize: 18 }}>💡</span>
                      为什么用加权平均？
                    </div>
                    <p style={{ marginTop: 8, marginBottom: 0, color: '#595959', fontSize: 13, lineHeight: 1.6 }}>
                      因为不同的代码单元重要性不同。一个 100 行的核心函数比一个 1 行的 import 语句更重要。
                      使用行数作为权重，可以让大的、重要的代码单元在最终相似度中占更大比例。
                    </p>
                  </div>
                </div>
              </div>

              {/* 拆分单元与匹配详情可视化 */}
              <Divider />

              {/* 拆分单元与匹配详情可视化 */}
              <Divider />
              <div className="step-section">
                <div className="step-section-title">分层匹配与 DFG 可视化详情</div>
                <div className="hierarchical-matches-list">
                  {hierarchicalResult.matches.map((match, idx) => {
                    const detailA = hierarchicalResult.encoding_details_a.find(d => d.name === match.unit_a);
                    const detailB = hierarchicalResult.encoding_details_b.find(d => d.name === match.unit_b);
                    
                    return (
                      <div key={idx} className="match-card">
                        <div className="match-card-header">
                          <span className="match-score">{match.similarity_percent.toFixed(1)}%</span>
                          <span className="match-weight">权重: {match.weight}</span>
                        </div>
                        <div className="match-card-body">
                          <div className="match-unit">
                            <div className="unit-name">
                              <Tag color="blue">代码A</Tag> {match.unit_a} <span className="unit-type">({match.type_a})</span>
                              {detailA?.truncated && <Tag color="red" style={{ marginLeft: 8 }}>已截断</Tag>}
                            </div>
                            <div className="unit-stats">
                              Token: {detailA?.token_count || 0} | 有效: {detailA?.effective_tokens || 0} | 行数: {detailA?.lines || 0}
                            </div>
                            {detailA?.dfg_string && (
                              <div className="unit-dfg" title={detailA.dfg_string}>
                                <strong>DFG:</strong> {detailA.dfg_string}
                              </div>
                            )}
                            {hierarchicalResult.units1 && (
                              <div className="unit-code">
                                <pre>{hierarchicalResult.units1.find(u => u.name === match.unit_a)?.code || ''}</pre>
                              </div>
                            )}
                          </div>
                          <div className="match-arrow">↔</div>
                          <div className="match-unit">
                            <div className="unit-name">
                              <Tag color="cyan">代码B</Tag> {match.unit_b} <span className="unit-type">({match.type_b})</span>
                              {detailB?.truncated && <Tag color="red" style={{ marginLeft: 8 }}>已截断</Tag>}
                            </div>
                            <div className="unit-stats">
                              Token: {detailB?.token_count || 0} | 有效: {detailB?.effective_tokens || 0} | 行数: {detailB?.lines || 0}
                            </div>
                            {detailB?.dfg_string && (
                              <div className="unit-dfg" title={detailB.dfg_string}>
                                <strong>DFG:</strong> {detailB.dfg_string}
                              </div>
                            )}
                            {hierarchicalResult.units2 && (
                              <div className="unit-code">
                                <pre>{hierarchicalResult.units2.find(u => u.name === match.unit_b)?.code || ''}</pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* 未匹配的单元 */}
                  {hierarchicalResult.unmatched_a.length > 0 && (
                    <div className="unmatched-section">
                      <div className="unmatched-title">代码A中被删除/未匹配的单元：</div>
                      <div className="unmatched-tags">
                        {hierarchicalResult.unmatched_a.map(name => (
                          <Tag color="red" key={name}>{name}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {hierarchicalResult.unmatched_b.length > 0 && (
                    <div className="unmatched-section">
                      <div className="unmatched-title">代码B中新增/未匹配的单元：</div>
                      <div className="unmatched-tags">
                        {hierarchicalResult.unmatched_b.map(name => (
                          <Tag color="green" key={name}>{name}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
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
function buildSideBySideView(_oldCode: string, _newCode: string, changes: any[]) {
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
