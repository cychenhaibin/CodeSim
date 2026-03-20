import React, { useState, useMemo } from 'react';
import { ASTDiffAnalyzer, DiffResult } from './utils/ASTDiffAnalyzer';
import CodeDiffViewer from './components/CodeDiffViewer';
import { Button, Alert, Spin, Upload } from 'antd';
import { SyncOutlined, UploadOutlined, CodeOutlined, FileOutlined } from '@ant-design/icons';
import TextArea from 'antd/es/input/TextArea';
import './App.css';

interface ModelStatus {
  status: 'ready' | 'loading' | 'error' | 'not_started';
  message: string;
}

export interface CodeUnit {
  name: string;
  type: string;
  code: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface UnitMatchResult {
  unit_a: string;
  type_a: string;
  lines_a: number;
  unit_b: string;
  type_b: string;
  lines_b: number;
  similarity: number;
  similarity_percent: number;
  weight: number;
}

export interface EncodingDetail {
  name: string;
  type: string;
  lines: number;
  token_count: number;
  effective_tokens: number;
  truncated: boolean;
  vector_norm: number;
  dfg_string: string;
}

export interface HierarchicalCompareResponse {
  similarity: number;
  similarity_percent: number;
  matches: UnitMatchResult[];
  unmatched_a: string[];
  unmatched_b: string[];
  total_weight: number;
  encoding_details_a: EncodingDetail[];
  encoding_details_b: EncodingDetail[];
  similarity_matrix: number[][];
  unit_names_a: string[];
  unit_names_b: string[];
  interpretation: string;
  units1?: CodeUnit[]; // 后端 Tree-sitter 拆分的单元，方便展示原始代码
  units2?: CodeUnit[]; // 后端 Tree-sitter 拆分的单元，方便展示原始代码
}

const App: React.FC = () => {
  const [mode, setMode] = useState<'upload' | 'compare'>('upload');
  const [oldFile, setOldFile] = useState<{ name: string; content: string } | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [hierarchicalResult, setHierarchicalResult] = useState<HierarchicalCompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);

  const analyzer = useMemo(() => {
    const a = new ASTDiffAnalyzer();
    a.enableDebug();
    return a;
  }, []);

  React.useEffect(() => {
    const checkModelStatus = async () => {
      try {
        const response = await fetch('/api/model-status');
        if (response.ok) {
          const data = await response.json();
          setModelStatus(data);
        }
      } catch {
        setModelStatus({ status: 'not_started', message: '后端服务未启动' });
      }
    };

    checkModelStatus();
    const interval = setInterval(checkModelStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleTextChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
    type: 'old' | 'new'
  ) => {
    const content = e.target.value;
    const fileData = { name: type === 'old' ? '代码1' : '代码2', content };

    if (type === 'old') {
      setOldFile(fileData);
    } else {
      setNewFile(fileData);
    }
  };

  const startCompare = async () => {
    if (!oldFile || !newFile) return;

    setLoading(true);
    setError(null);
    setHierarchicalResult(null);

    try {
      const result = analyzer.analyzeDiff(oldFile.content, newFile.content);
      setDiffResult(result);

      if (modelStatus?.status === 'ready') {
        try {
          // 检测语言（根据文件扩展名）
          const detectLang = (filename: string): string => {
            if (filename.endsWith('.tsx')) return 'tsx';
            if (filename.endsWith('.ts')) return 'typescript';
            if (filename.endsWith('.jsx') || filename.endsWith('.js')) return 'javascript';
            if (filename.endsWith('.py')) return 'python';
            return 'javascript'; // 默认
          };
          
          const lang = detectLang(oldFile.name || newFile.name || '');
          
          // 1. 后端用 Tree-sitter 拆分代码单元（CST 精确拆分，不丢失代码）
          const splitResponse = await fetch('/api/split-with-treesitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code1: oldFile.content,
              code2: newFile.content,
              lang,
            }),
          });
          
          if (!splitResponse.ok) {
            throw new Error('Tree-sitter 拆分失败');
          }
          
          const splitData = await splitResponse.json();

          // 2. 调用分层编码接口（DFG 提取 + GraphCodeBERT 编码 + 匈牙利匹配）
          const response = await fetch('/api/compare-hierarchical', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              units1: splitData.units1,
              units2: splitData.units2,
              lang,  // 使用检测到的语言
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            // 附加拆分的单元内容，方便展示原始代码
            data.units1 = splitData.units1;
            data.units2 = splitData.units2;
            setHierarchicalResult(data);
          }
        } catch (e) {
          console.log('综合语义相似度计算失败:', e);
        }
      }

      setMode('compare');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AST 分析失败');
    } finally {
      setLoading(false);
    }
  };

  const resetFiles = () => {
    setOldFile(null);
    setNewFile(null);
    setDiffResult(null);
    setHierarchicalResult(null);
    setMode('upload');
    setError(null);
  };

  const renderUploadBox = (type: 'old' | 'new') => {
    const file = type === 'old' ? oldFile : newFile;
    const label = type === 'old' ? '样板代码 / 原始代码' : '待比较代码';

    return (
      <div className="upload-box">
        <div className="upload-label">
          <CodeOutlined style={{ fontSize: 16 }} />
          <span>{label}</span>
        </div>
        <Upload
          accept=".js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.txt,.vue,.go,.rs,.rb,.php,.cs,.swift,.kt"
          showUploadList={false}
          maxCount={1}
          beforeUpload={(uploadFile) => {
            uploadFile.text().then(content => {
              const fileData = { name: uploadFile.name, content };
              if (type === 'old') setOldFile(fileData);
              else setNewFile(fileData);
            });
            return false;
          }}
        >
          <div className="file-trigger">
            {file ? (
              <span className="file-selected"><FileOutlined style={{ marginRight: 6 }} />{file.name}</span>
            ) : (
              <span className="file-placeholder"><UploadOutlined style={{ marginRight: 6 }} />点击或拖拽文件到此处</span>
            )}
          </div>
        </Upload>
        <TextArea
          className="code-textarea"
          placeholder="或直接粘贴代码..."
          value={file?.content || ''}
          onChange={(e) => handleTextChange(e, type)}
          autoSize={{ minRows: 8, maxRows: 20 }}
          style={{ resize: 'vertical', fontFamily: "'Monaco', 'Menlo', 'Consolas', monospace", fontSize: 13 }}
        />
      </div>
    );
  };

  if (mode === 'upload') {
    return (
      <div className="upload-container">
        <div className="upload-card">
          <h1>AST + GraphCodeBERT 代码对比</h1>
          <p className="subtitle">基于 AST 结构分析 + 深度学习语义相似度</p>

          <div className="upload-section">
            {renderUploadBox('old')}

            <div className="arrow">
              <SyncOutlined style={{ fontSize: 28 }} />
            </div>

            {renderUploadBox('new')}
          </div>

          {error && (
            <Alert type="error" message={error} showIcon className="error-message" />
          )}

          {modelStatus && modelStatus.status === 'loading' && (
            <Alert
              type="warning"
              showIcon
              className="model-status"
              message={
                <span>
                  <Spin size="small" style={{ marginRight: 8 }} />
                  GraphCodeBERT 模型加载中...（可先使用 AST 分析）
                </span>
              }
            />
          )}

          <Button
            type="primary"
            block
            className="compare-button"
            onClick={startCompare}
            disabled={!oldFile?.content || !newFile?.content}
            loading={loading}
          >
            {loading ? '分析中...' : '开始对比分析'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="compare-container">
      {oldFile && newFile && diffResult && (
        <CodeDiffViewer
          oldCode={oldFile.content}
          newCode={newFile.content}
          oldFileName={oldFile.name}
          newFileName={newFile.name}
          diffResult={diffResult}
          hierarchicalResult={hierarchicalResult}
          onBack={resetFiles}
        />
      )}
    </div>
  );
};

export default App;
