import React from 'react';

const SkeletonRow = () => (
    <tr className="border-b border-slate-800">
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-3/4 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-1/2 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-1/3 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-5/6 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-1/4 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-4 bg-slate-700 rounded w-1/3 animate-pulse"></div>
        </td>
        <td className="p-3">
            <div className="h-6 bg-cyan-800/50 rounded w-20 animate-pulse"></div>
        </td>
    </tr>
);

const SkeletonLoader: React.FC<{ rows?: number }> = ({ rows = 10 }) => {
    return (
        <>{[...Array(rows)].map((_, i) => <SkeletonRow key={i} />)}</>
    );
};

export default SkeletonLoader;