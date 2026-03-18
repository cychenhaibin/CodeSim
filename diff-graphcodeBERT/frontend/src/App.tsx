import React, { useState, useMemo } from 'react';
import { ASTDiffAnalyzer, DiffResult } from './utils/ASTDiffAnalyzer';
import { serializeToSBT } from './utils/ASTSerializer';
import CodeDiffViewer from './components/CodeDiffViewer';
import { Button, Alert, Spin, Upload } from 'antd';
import { SyncOutlined, UploadOutlined, CodeOutlined, FileOutlined } from '@ant-design/icons';
import TextArea from 'antd/es/input/TextArea';
import './App.css';

interface ModelStatus {
  status: 'ready' | 'loading' | 'error' | 'not_started';
  message: string;
}

interface ASTSimilarityResponse {
  similarity: number;
  similarity_percent: number;
  interpretation: string;
  sbt1_tokens: number;
  sbt2_tokens: number;
}

interface ModelSimilarityResponse {
  similarity: number;
  similarity_percent: number;
  interpretation: string;
  raw_cosine_similarity?: number;
  text_similarity?: number;
  code1_analysis?: { token_count: number; dfg_edges: number };
  code2_analysis?: { token_count: number; dfg_edges: number };
}

const App: React.FC = () => {
  const [mode, setMode] = useState<'upload' | 'compare'>('upload');
  const [oldFile, setOldFile] = useState<{ name: string; content: string } | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [astSimilarity, setAstSimilarity] = useState<ASTSimilarityResponse | null>(null);
  const [modelSimilarity, setModelSimilarity] = useState<ModelSimilarityResponse | null>(null);
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
    setAstSimilarity(null);
    setModelSimilarity(null);

    try {
      const result = analyzer.analyzeDiff(oldFile.content, newFile.content);
      setDiffResult(result);

      if (modelStatus?.status === 'ready') {
        try {
          const detectLang = (name: string) => {
            const ext = name.split('.').pop()?.toLowerCase() || '';
            if (['ts', 'tsx'].includes(ext)) return 'typescript';
            return 'javascript';
          };
          const sbt1 = serializeToSBT(oldFile.content, detectLang(oldFile.name));
          const sbt2 = serializeToSBT(newFile.content, detectLang(newFile.name));
          
          console.log('SBT1 预览:', sbt1.substring(0, 200));
          console.log('SBT2 预览:', sbt2.substring(0, 200));
          
          const astResponse = await fetch('/api/ast-similarity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sbt1, sbt2 }),
          });
          
          if (astResponse.ok) {
            const astData = await astResponse.json();
            setAstSimilarity(astData);
          }
        } catch (e) {
          console.log('AST 编码 API 调用失败:', e);
        }
        
        try {
          const response = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code1: oldFile.content,
              code2: newFile.content,
              lang: 'javascript',
            }),
          });
          if (response.ok) {
            const data = await response.json();
            setModelSimilarity({
              similarity: data.similarity,
              similarity_percent: data.similarity_percent,
              interpretation: data.interpretation,
              raw_cosine_similarity: data.raw_cosine_similarity,
              text_similarity: data.text_similarity,
              code1_analysis: data.code1_analysis,
              code2_analysis: data.code2_analysis,
            });
          }
        } catch {
          console.log('GraphCodeBERT API 调用失败');
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
    setAstSimilarity(null);
    setModelSimilarity(null);
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
          astSimilarity={astSimilarity}
          modelSimilarity={modelSimilarity}
          onBack={resetFiles}
        />
      )}
    </div>
  );
};

export default App;
