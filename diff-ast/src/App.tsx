// src/App.tsx
import React, { useState, Suspense, lazy } from 'react';
import './App.css';

const CodeDiffViewer = lazy(() => import('./components/CodeDiffViewer'));

const App: React.FC = () => {
  const [mode, setMode] = useState<'upload' | 'compare'>('upload');
  const [oldFile, setOldFile] = useState<{ name: string; content: string } | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; content: string } | null>(null);

  // 处理文件上传
  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'old' | 'new'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    const validExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.'));
    
    if (!validExtensions.includes(fileExtension)) {
      alert('请上传 .ts, .tsx, .js, .jsx 或 .vue 文件');
      return;
    }

    try {
      const content = await file.text();
      const fileData = { name: file.name, content };

      if (type === 'old') {
        setOldFile(fileData);
      } else {
        setNewFile(fileData);
      }
    } catch (error) {
      alert('文件读取失败');
      console.error(error);
    }
  };

  // 开始比较
  const startCompare = () => {
    if (oldFile && newFile) {
      setMode('compare');
    }
  };

  // 重新选择
  const resetFiles = () => {
    setOldFile(null);
    setNewFile(null);
    setMode('upload');
  };

  // 上传界面
  if (mode === 'upload') {
    return (
      <div className="upload-container">
        <div className="upload-card">
          <h1>代码相似度对比</h1>
          <p className="subtitle">基于AST的智能代码差异分析</p>

          <div className="upload-section">
            <div className="upload-box">
              <div className="upload-label">
                <span>样板代码文件</span>
              </div>
              <input
                type="file"
                accept=".ts,.tsx,.js,.jsx,.vue"
                onChange={(e) => handleFileUpload(e, 'old')}
                id="old-file"
                className="file-input"
              />
              <label htmlFor="old-file" className="file-label">
                {oldFile ? (
                  <span className="file-selected">✓ {oldFile.name}</span>
                ) : (
                  <span>点击选择文件</span>
                )}
              </label>
            </div>

            <div className="arrow">→</div>

            <div className="upload-box">
              <div className="upload-label">
                <span>AI生成代码文件</span>
              </div>
              <input
                type="file"
                accept=".ts,.tsx,.js,.jsx,.vue"
                onChange={(e) => handleFileUpload(e, 'new')}
                id="new-file"
                className="file-input"
              />
              <label htmlFor="new-file" className="file-label">
                {newFile ? (
                  <span className="file-selected">✓ {newFile.name}</span>
                ) : (
                  <span>点击选择文件</span>
                )}
              </label>
            </div>
          </div>

          <button
            className="compare-button"
            onClick={startCompare}
            disabled={!oldFile || !newFile}
          >
            开始对比分析
          </button>

        </div>
      </div>
    );
  }

  // 对比界面
  return (
    <div className="compare-container">
      {oldFile && newFile && (
        <Suspense fallback={<div className="loading">加载对比视图...</div>}>
          <CodeDiffViewer
            oldCode={oldFile.content}
            newCode={newFile.content}
            oldFileName={oldFile.name}
            newFileName={newFile.name}
            onBack={resetFiles}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;