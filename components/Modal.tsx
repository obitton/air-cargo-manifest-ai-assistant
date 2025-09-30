import React, { useEffect } from 'react';
import { CloseIcon } from './IconComponents';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
}

const sizeToClasses: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    fullscreen: 'w-screen h-screen max-w-none'
};

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    const isLight = typeof document !== 'undefined' && document.body?.dataset?.theme === 'light';
    const containerBase = isLight ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-700';
    const headerText = isLight ? 'text-slate-900' : 'text-white';
    const headerBorder = isLight ? 'border-slate-200' : 'border-slate-700';
    const footerBg = isLight ? 'bg-slate-50' : 'bg-slate-800/80';
    const overlay = isLight ? 'bg-black/50' : 'bg-black bg-opacity-70';

    const containerClasses = size === 'fullscreen'
        ? `${containerBase} rounded-none shadow-2xl w-screen h-screen`
        : `${containerBase} rounded-lg shadow-2xl w-full ${sizeToClasses[size]} m-4`;

    return (
        <div 
            className={`fixed inset-0 ${overlay} z-50 flex justify-center items-center`} 
            aria-modal="true" 
            role="dialog"
            onClick={onClose}
        >
            <div 
                className={containerClasses}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={`flex items-center justify-between p-4 border-b ${headerBorder}`}>
                    <h2 className={`text-lg font-semibold ${headerText}`}>{title}</h2>
                    <button onClick={onClose} className={`transition-colors ${isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'}`} aria-label="Close modal">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>
                <div className={`p-6 ${size === 'fullscreen' ? 'h-[calc(100vh-128px)] overflow-auto' : ''}`}>
                    {children}
                </div>
                {footer && (
                    <div className={`p-4 border-t ${headerBorder} ${footerBg}`}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
