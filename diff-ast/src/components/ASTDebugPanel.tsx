// ========================================================================
// components/ASTDebugPanel.tsx
// AST 调试面板组件
// 用于可视化展示 AST 对比分析的每一步过程
// ========================================================================

// React 和常用 Hooks
import React, { useState } from 'react';
// 导入调试相关的类型定义
import { DebugInfo, ASTNodeInfo, LCSMatchPair, DebugStep } from '../utils/ASTDiffAnalyzer';
// 导入组件样式
import './ASTDebugPanel.css';

/**
 * 组件属性接口
 */
interface ASTDebugPanelProps {
  debugInfo: DebugInfo;  // 调试信息对象（包含步骤、节点、匹配对等）
  onClose?: () => void;  // 关闭面板的回调函数
}

/**
 * AST 调试面板组件
 * 
 * 提供三个标签页：
 * 1. 分析步骤 - 展示分析过程的时间线
 * 2. AST 节点 - 并排展示两份代码的AST节点
 * 3. LCS 匹配 - 展示LCS算法的匹配结果
 */
const ASTDebugPanel: React.FC<ASTDebugPanelProps> = ({ debugInfo, onClose }) => {
  // ===== 状态定义 =====
  
  // 当前激活的标签页：'steps' | 'ast' | 'lcs'
  const [activeTab, setActiveTab] = useState<'steps' | 'ast' | 'lcs'>('steps');
  
  // 展开的步骤编号集合（默认展开前3个步骤）
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([1, 2, 3]));
  
  // 当前选中的节点索引（用于高亮显示）
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);

  /**
   * 切换步骤的展开/收起状态
   * 
   * @param stepNumber - 步骤编号
   */
  const toggleStep = (stepNumber: number) => {
    // 复制当前集合（React要求状态不可变）
    const newExpanded = new Set(expandedSteps);
    
    if (newExpanded.has(stepNumber)) {
      // 已展开则收起
      newExpanded.delete(stepNumber);
    } else {
      // 未展开则展开
      newExpanded.add(stepNumber);
    }
    
    // 更新状态
    setExpandedSteps(newExpanded);
  };

  /**
   * 格式化耗时显示
   * 根据时间长短选择合适的单位
   * 
   * @param ms - 毫秒数
   * @returns 格式化后的字符串
   */
  const formatDuration = (ms: number | undefined) => {
    if (ms === undefined) return '';      // 未定义返回空
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;  // 小于1ms显示微秒
    if (ms < 1000) return `${ms.toFixed(2)}ms`;        // 小于1s显示毫秒
    return `${(ms / 1000).toFixed(2)}s`;               // 否则显示秒
  };

  /**
   * 递归渲染数据对象
   * 将任意类型的数据转换为可视化的React节点
   * 
   * @param data - 要渲染的数据
   * @param depth - 当前递归深度（用于控制缩进和截断）
   * @returns React节点
   */
  const renderData = (data: unknown, depth = 0): React.ReactNode => {
    // 处理 null 和 undefined
    if (data === null || data === undefined) {
      return <span className="data-null">null</span>;
    }
    
    // 处理布尔值
    if (typeof data === 'boolean') {
      return <span className="data-boolean">{data.toString()}</span>;
    }
    
    // 处理数字
    if (typeof data === 'number') {
      return <span className="data-number">{data}</span>;
    }
    
    // 处理字符串
    if (typeof data === 'string') {
      return <span className="data-string">"{data}"</span>;
    }
    
    // 处理数组
    if (Array.isArray(data)) {
      // 空数组
      if (data.length === 0) return <span className="data-array">[]</span>;
      // 深度过大时截断
      if (depth > 2) return <span className="data-array">[...{data.length} items]</span>;
      
      return (
        <div className="data-array" style={{ marginLeft: depth * 12 }}>
          [
          {/* 最多显示10个元素 */}
          {data.slice(0, 10).map((item, i) => (
            <div key={i} className="data-array-item">
              {renderData(item, depth + 1)}
              {/* 非最后一个元素后加逗号 */}
              {i < Math.min(data.length, 10) - 1 && ','}
            </div>
          ))}
          {/* 超过10个显示省略提示 */}
          {data.length > 10 && <div className="data-more">...({data.length - 10} more)</div>}
          ]
        </div>
      );
    }
    
    // 处理对象
    if (typeof data === 'object') {
      const entries = Object.entries(data);
      // 空对象
      if (entries.length === 0) return <span className="data-object">{'{}'}</span>;
      // 深度过大时截断
      if (depth > 2) return <span className="data-object">{'{'} ...{entries.length} keys {'}'}</span>;
      
      return (
        <div className="data-object" style={{ marginLeft: depth * 12 }}>
          {'{'}
          {/* 最多显示15个键值对 */}
          {entries.slice(0, 15).map(([key, value], i) => (
            <div key={key} className="data-object-entry">
              <span className="data-key">{key}</span>: {renderData(value, depth + 1)}
              {i < Math.min(entries.length, 15) - 1 && ','}
            </div>
          ))}
          {entries.length > 15 && <div className="data-more">...({entries.length - 15} more)</div>}
          {'}'}
        </div>
      );
    }
    
    // 其他类型转为字符串
    return <span>{String(data)}</span>;
  };

  /**
   * 渲染「分析步骤」标签页
   * 展示分析过程的时间线
   */
  const renderStepsTab = () => (
    <div className="debug-steps">
      {/* 头部统计信息 */}
      <div className="steps-header">
        <span className="steps-count">共 {debugInfo.steps.length} 个步骤</span>
        <span className="steps-duration">总耗时: {formatDuration(debugInfo.totalDuration)}</span>
      </div>
      
      {/* 步骤时间线 */}
      <div className="steps-timeline">
        {/* 遍历渲染每个步骤 */}
        {debugInfo.steps.map((step) => (
          <div 
            key={step.stepNumber} 
            className={`step-item ${expandedSteps.has(step.stepNumber) ? 'expanded' : ''}`}
          >
            {/* 步骤头部（可点击展开/收起） */}
            <div 
              className="step-header"
              onClick={() => toggleStep(step.stepNumber)}
            >
              {/* 步骤序号（圆形徽章） */}
              <span className="step-number">{step.stepNumber}</span>
              {/* 步骤标题 */}
              <span className="step-title">{step.title}</span>
              {/* 步骤耗时 */}
              <span className="step-duration">{formatDuration(step.duration)}</span>
              {/* 展开/收起指示器 */}
              <span className="step-toggle">{expandedSteps.has(step.stepNumber) ? '▼' : '▶'}</span>
            </div>
            
            {/* 步骤详情（展开时显示） */}
            {expandedSteps.has(step.stepNumber) && (
              <div className="step-content">
                {/* 步骤描述 */}
                <div className="step-description">{step.description}</div>
                {/* 步骤数据 */}
                <div className="step-data">
                  <div className="data-label">数据:</div>
                  {renderData(step.data)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  /**
   * 渲染「AST 节点」标签页
   * 并排展示两份代码的AST节点列表
   */
  const renderASTTab = () => {
    // 获取节点列表（默认为空数组）
    const oldNodes = debugInfo.oldASTNodes || [];
    const newNodes = debugInfo.newASTNodes || [];
    
    return (
      <div className="ast-comparison">
        {/* 统计信息区域 */}
        <div className="ast-stats">
          <div className="ast-stat">
            <span className="stat-label">旧代码节点数:</span>
            <span className="stat-value">{oldNodes.length}</span>
          </div>
          <div className="ast-stat">
            <span className="stat-label">新代码节点数:</span>
            <span className="stat-value">{newNodes.length}</span>
          </div>
          <div className="ast-stat">
            <span className="stat-label">匹配节点对:</span>
            <span className="stat-value">{debugInfo.lcsMatchPairs?.length || 0}</span>
          </div>
        </div>
        
        {/* 两棵AST树并排显示 */}
        <div className="ast-trees">
          {/* 左侧：旧代码的AST节点 */}
          <div className="ast-tree old-tree">
            <div className="tree-title">旧代码 AST 节点</div>
            <div className="tree-content">
              {/* 最多显示100个节点 */}
              {oldNodes.slice(0, 100).map((node) => (
                <div
                  key={node.index}
                  // 根据匹配状态和选中状态应用不同样式
                  className={`ast-node ${node.matched ? 'matched' : 'unmatched'} ${selectedNodeIndex === node.index ? 'selected' : ''}`}
                  // 缩进表示深度（最大80px）
                  style={{ paddingLeft: Math.min(node.depth * 8, 80) }}
                  onClick={() => setSelectedNodeIndex(node.index)}
                >
                  {/* 节点索引 */}
                  <span className="node-index">{node.index}</span>
                  {/* 节点类型 */}
                  <span className="node-type">{node.type}</span>
                </div>
              ))}
              {/* 超过100个显示省略提示 */}
              {oldNodes.length > 100 && (
                <div className="tree-more">...还有 {oldNodes.length - 100} 个节点</div>
              )}
            </div>
          </div>
          
          {/* 右侧：新代码的AST节点 */}
          <div className="ast-tree new-tree">
            <div className="tree-title">新代码 AST 节点</div>
            <div className="tree-content">
              {newNodes.slice(0, 100).map((node) => (
                <div
                  key={node.index}
                  className={`ast-node ${node.matched ? 'matched' : 'unmatched'} ${selectedNodeIndex === node.index ? 'selected' : ''}`}
                  style={{ paddingLeft: Math.min(node.depth * 8, 80) }}
                  onClick={() => setSelectedNodeIndex(node.index)}
                >
                  <span className="node-index">{node.index}</span>
                  <span className="node-type">{node.type}</span>
                </div>
              ))}
              {newNodes.length > 100 && (
                <div className="tree-more">...还有 {newNodes.length - 100} 个节点</div>
              )}
            </div>
          </div>
        </div>
        
        {/* 图例说明 */}
        <div className="ast-legend">
          <span className="legend-item matched">● 已匹配</span>
          <span className="legend-item unmatched">● 未匹配（差异）</span>
        </div>
      </div>
    );
  };

  /**
   * 渲染「LCS 匹配」标签页
   * 展示LCS算法的匹配结果和统计
   */
  const renderLCSTab = () => {
    // 获取匹配对列表
    const matchPairs = debugInfo.lcsMatchPairs || [];
    
    // 统计每种节点类型的匹配数量
    const typeStats = new Map<string, number>();
    matchPairs.forEach(pair => {
      typeStats.set(pair.nodeType, (typeStats.get(pair.nodeType) || 0) + 1);
    });

    return (
      <div className="lcs-analysis">
        {/* 算法说明 */}
        <div className="lcs-summary">
          <h3>LCS (最长公共子序列) 匹配结果</h3>
          <p className="lcs-description">
            LCS 算法通过比较两棵 AST 树的节点类型序列，找出它们的最长公共子序列。
            匹配的节点对表示结构上相同的代码部分，未匹配的节点则代表差异。
          </p>
        </div>
        
        {/* 按节点类型统计 */}
        <div className="lcs-type-stats">
          <h4>按节点类型统计匹配数量</h4>
          <div className="type-stats-grid">
            {/* 按数量降序排列，最多显示20个 */}
            {Array.from(typeStats.entries())
              .sort((a, b) => b[1] - a[1])  // 按数量降序
              .slice(0, 20)
              .map(([type, count]) => (
                <div key={type} className="type-stat-item">
                  {/* 节点类型名 */}
                  <span className="type-name">{type}</span>
                  {/* 匹配数量 */}
                  <span className="type-count">{count}</span>
                  {/* 可视化进度条 */}
                  <div 
                    className="type-bar" 
                    style={{ width: `${(count / matchPairs.length) * 100}%` }}
                  />
                </div>
              ))}
          </div>
        </div>

        {/* 匹配节点对表格 */}
        <div className="lcs-pairs">
          <h4>匹配节点对 (前50个)</h4>
          <div className="pairs-table">
            {/* 表头 */}
            <div className="pairs-header">
              <span>旧索引</span>
              <span>新索引</span>
              <span>节点类型</span>
            </div>
            {/* 表格内容 */}
            {matchPairs.slice(0, 50).map((pair, i) => (
              <div key={i} className="pair-row">
                {/* 旧代码中的索引 */}
                <span className="pair-old">{pair.oldIndex}</span>
                {/* 新代码中的索引 */}
                <span className="pair-new">{pair.newIndex}</span>
                {/* 匹配的节点类型 */}
                <span className="pair-type">{pair.nodeType}</span>
              </div>
            ))}
            {/* 超过50个显示省略提示 */}
            {matchPairs.length > 50 && (
              <div className="pairs-more">...还有 {matchPairs.length - 50} 个匹配对</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ===== 渲染组件 =====
  return (
    <div className="ast-debug-panel">
      {/* 面板头部 */}
      <div className="debug-header">
        {/* 标题 */}
        <h2>AST 对比调试面板</h2>
        
        {/* 标签页切换按钮 */}
        <div className="debug-tabs">
          {/* 分析步骤标签 */}
          <button
            className={`tab-btn ${activeTab === 'steps' ? 'active' : ''}`}
            onClick={() => setActiveTab('steps')}
          >
            分析步骤
          </button>
          {/* AST节点标签 */}
          <button
            className={`tab-btn ${activeTab === 'ast' ? 'active' : ''}`}
            onClick={() => setActiveTab('ast')}
          >
            AST 节点
          </button>
          {/* LCS匹配标签 */}
          <button
            className={`tab-btn ${activeTab === 'lcs' ? 'active' : ''}`}
            onClick={() => setActiveTab('lcs')}
          >
            LCS 匹配
          </button>
        </div>
        
        {/* 关闭按钮 */}
        {onClose && (
          <button className="close-btn" onClick={onClose}>✕</button>
        )}
      </div>
      
      {/* 面板内容区域 */}
      <div className="debug-content">
        {/* 根据当前激活的标签渲染对应内容 */}
        {activeTab === 'steps' && renderStepsTab()}
        {activeTab === 'ast' && renderASTTab()}
        {activeTab === 'lcs' && renderLCSTab()}
      </div>
    </div>
  );
};

// 导出组件
export default ASTDebugPanel;
