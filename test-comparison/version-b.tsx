import React, { useState } from 'react';

interface Props {
  onUpload: (file: File) => void;
}

const FileUploader: React.FC<Props> = ({ onUpload }) => {
  const [uploadDownload, setUploadDownload] = useState<File | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      setUploadDownload(selectedFile);
      onUpload(selectedFile);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <input
        type="file"
        onChange={handleFileChange}
        accept=".tsx,.ts,.jsx,.js"
      />
      {uploadDownload && (
        <div>
          <p>已选择: {uploadDownload.name}</p>
          <p>大小: {uploadDownload.size} bytes</p>
        </div>
      )}
    </div>
  );
};

export default FileUploader;
