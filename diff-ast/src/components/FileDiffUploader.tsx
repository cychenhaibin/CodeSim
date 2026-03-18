// components/FileDiffUploader.tsx
import React, { useState } from 'react';
import CodeDiffViewer from './CodeDiffViewer';

const FileDiffUploader: React.FC = () => {
  const [oldFile, setOldFile] = useState<{ name: string; content: string } | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; content: string } | null>(null);

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    side: 'old' | 'new'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    const fileData = { name: file.name, content };

    if (side === 'old') {
      setOldFile(fileData);
    } else {
      setNewFile(fileData);
    }
  };

  if (oldFile && newFile) {
    return (
      <div>
        <button onClick={() => { setOldFile(null); setNewFile(null); }}>
          重新选择文件
        </button>
        <CodeDiffViewer
          oldCode={oldFile.content}
          newCode={newFile.content}
          oldFileName={oldFile.name}
          newFileName={newFile.name}
        />
      </div>
    );
  }

  return (
    <div className="file-uploader">
      <h2>上传要对比的代码文件</h2>
      <div className="upload-section">
        <div className="upload-box">
          <label>旧版本文件</label>
          <input
            type="file"
            accept=".ts,.tsx,.js,.jsx,.vue"
            onChange={(e) => handleFileUpload(e, 'old')}
          />
          {oldFile && <span>✓ {oldFile.name}</span>}
        </div>

        <div className="upload-box">
          <label>新版本文件</label>
          <input
            type="file"
            accept=".ts,.tsx,.js,.jsx,.vue"
            onChange={(e) => handleFileUpload(e, 'new')}
          />
          {newFile && <span>✓ {newFile.name}</span>}
        </div>
      </div>
    </div>
  );
};

export default FileDiffUploader;