import React, { useState, useCallback } from 'react';
import { DocumentIcon, CloseIcon } from './IconComponents';

interface FileUploadProps {
    onFileUpload: (file: File) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        setError(null);

        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                setError('File is too large. Maximum size is 5MB.');
                return;
            }
            onFileUpload(file);
        }
    }, [onFileUpload]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
             if (file.size > 5 * 1024 * 1024) { // 5MB limit
                setError('File is too large. Maximum size is 5MB.');
                return;
            }
            onFileUpload(file);
        }
    };

    return (
        <div className="w-full">
            <label
                htmlFor="file-upload"
                className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors
                    ${isDragging ? 'border-cyan-500 bg-slate-800' : 'border-slate-600 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-800/70'}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <DocumentIcon className="w-10 h-10 mb-3 text-slate-500" />
                    <p className="mb-2 text-sm text-slate-400">
                        <span className="font-semibold text-cyan-400">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-slate-500">PDF, PNG, JPG, DOCX (MAX. 5MB)</p>
                </div>
                <input id="file-upload" type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.png,.jpg,.jpeg,.docx" />
            </label>
            {error && (
                 <div className="mt-3 flex items-center justify-between p-3 rounded-md bg-red-900/50 text-red-300">
                    <p className="text-sm">{error}</p>
                    <button onClick={() => setError(null)} className="p-1 rounded-full hover:bg-red-800/50">
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default FileUpload;