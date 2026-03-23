import React, { useState } from 'react';

interface Props {
  onUpload: (file: File) => void;
}

const FileUploader: React.FC<Props> = ({ onUpload }) => {
  const [uploadExample, setUploadExample] = useState<File | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      setUploadExample(selectedFile);
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
      {uploadExample && (
        <div>
          <p>已选择: {uploadExample.name}</p>
          <p>大小: {uploadExample.size} bytes</p>
        </div>
      )}
    </div>
  );
};

export default FileUploader;
