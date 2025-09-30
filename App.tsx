import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { ManifestData, Shipment, HouseShipment, ULDContent, SelectedItem, ManifestSummary, ShipmentIssue } from './types';
import { SearchIcon, DocumentIcon, CubeIcon, ScaleIcon, InfoIcon, ArrowLeftIcon, ChatBubbleIcon, ArrowUpIcon, ArrowDownIcon, WarningIcon, CloseIcon } from './components/IconComponents';
import ChatAssistant from './components/ChatAssistant';
import FileUpload from './components/FileUpload';
import { getManifests, getManifestDetails, ManifestFilters } from './services/apiService';
import { debounce, analyzeShipment } from './utils';
import LoadingSpinner from './components/LoadingSpinner';
import Modal from './components/Modal';

const App: React.FC = () => {
    const [view, setView] = useState<'list' | 'detail'>('list');
    
    // State for the list view
    const [manifests, setManifests] = useState<ManifestSummary[]>([]);
    const [filters, setFilters] = useState<ManifestFilters>({
        manifestNo: '',
        flightNo: '',
        page: 1,
        pageSize: 15,
        sortBy: 'createdAt',
        sortDir: 'desc'
    });
    const [paginationInfo, setPaginationInfo] = useState({
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
    });
    const [isListLoading, setIsListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);

    // Theme
    const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as any) || 'dark');
    useEffect(() => {
        localStorage.setItem('theme', theme);
        if (typeof document !== 'undefined') {
            document.body.dataset.theme = theme;
        }
    }, [theme]);

    // State for the detail view
    const [currentManifest, setCurrentManifest] = useState<ManifestData | null>(null);
    const [selectedMawb, setSelectedMawb] = useState<Shipment | null>(null);
    const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'details' | 'ulds' | 'hawbs' | 'issues' | 'documents'>('details');
    const [shipmentIssues, setShipmentIssues] = useState<ShipmentIssue[]>([]);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    // State for Chat Assistant
    const [isChatOpen, setIsChatOpen] = useState(false);
    
    const fetchManifests = useCallback(async (currentFilters: ManifestFilters) => {
        setIsListLoading(true);
        setListError(null);
        try {
            const data = await getManifests(currentFilters);
            setManifests(data.docs);
            setPaginationInfo({
                page: data.page,
                totalPages: data.totalPages,
                hasNextPage: data.hasNextPage,
                hasPrevPage: data.hasPrevPage,
            });
        } catch (error: any) {
            setListError(error.message || 'Failed to fetch manifests.');
            setManifests([]);
        } finally {
            setIsListLoading(false);
        }
    }, []);

    const debouncedFetchManifests = useMemo(() => debounce(fetchManifests, 300), [fetchManifests]);
    
    useEffect(() => {
        debouncedFetchManifests(filters);
    }, [filters, debouncedFetchManifests]);

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value, page: 1 }));
    };

    const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setFilters(prev => ({ ...prev, sortBy: e.target.value, page: 1 }));
    };
    
    const handleSortDirToggle = () => {
        setFilters(prev => ({ ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }));
    };

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= paginationInfo.totalPages) {
            setFilters(prev => ({ ...prev, page: newPage }));
        }
    };

    const handleViewDetails = async (manifestId: string) => {
        setIsDetailLoading(true);
        setDetailError(null);
        setView('detail');
        try {
            if (!manifestId) {
                throw new Error("Invalid Manifest ID provided.");
            }
            const data = await getManifestDetails(manifestId);
            setCurrentManifest(data);

            if (data?.shipments?.length > 0) {
                const firstMawb = data.shipments[0];
                handleSelectMawb(firstMawb);
                if (firstMawb.uld_contents?.length > 0) {
                  setSelectedItem(firstMawb.uld_contents[0]);
                } else if (firstMawb.house_shipments?.length > 0) {
                  setSelectedItem(firstMawb.house_shipments[0]);
                } else {
                  setSelectedItem(null);
                }
            } else {
                setSelectedMawb(null);
                setSelectedItem(null);
                setShipmentIssues([]);
            }
        } catch (error: any) {
            setDetailError(error.message || `Failed to fetch details for manifest.`);
            setCurrentManifest(null);
        } finally {
            setIsDetailLoading(false);
        }
    };
    
    const handleBackToList = () => {
        setView('list');
        setCurrentManifest(null);
        setSelectedMawb(null);
        setSelectedItem(null);
        setDetailError(null);
        setShipmentIssues([]);
        setUploadedFiles([]);
    };

    const handleSelectMawb = (mawb: Shipment) => {
        setSelectedMawb(mawb);
        setSelectedItem(null);
        setActiveTab('details');
        setShipmentIssues(analyzeShipment(mawb));
        setUploadedFiles([]); // Reset files on new MAWB selection
    };

    const handleSelectItem = (item: SelectedItem) => {
        setSelectedItem(item);
    };

    const handleFileUpload = (file: File) => {
        setUploadedFiles(prevFiles => [...prevFiles, file]);
    };

    const handleRemoveFile = (fileName: string) => {
        setUploadedFiles(prevFiles => prevFiles.filter(f => f.name !== fileName));
    };

    const clearErrors = () => {
        setListError(null);
        setDetailError(null);
    };
    
    const filteredShipments = useMemo(() => {
        if (!currentManifest || !currentManifest.shipments) return [];
        if (!searchTerm) return currentManifest.shipments;
        return currentManifest.shipments.filter(shipment =>
            shipment.awb_number.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [searchTerm, currentManifest]);
    
    const renderItemDetails = () => {
        if (!selectedItem) {
            return <div className="text-slate-500 text-center p-8">Select an item from the details panel to see specifics.</div>;
        }
        if ('uld_id' in selectedItem) {
            const uld = selectedItem as ULDContent;
            return <div className="space-y-4"><h3 className="text-lg font-semibold text-white flex items-center"><CubeIcon className="w-5 h-5 mr-2 text-cyan-400" /> ULD Details</h3><div className="bg-slate-900/50 p-4 rounded-md space-y-2"><p><strong>ID:</strong> <span className="font-mono bg-slate-700 px-2 py-1 rounded">{uld.uld_id}</span></p><p><strong>Pieces:</strong> {uld.pieces}</p><p><strong>Weight:</strong> {uld.weight.value.toLocaleString()} {uld.weight.unit}</p></div></div>;
        } else {
            const hawb = selectedItem as HouseShipment;
            return <div className="space-y-4"><h3 className="text-lg font-semibold text-white flex items-center"><DocumentIcon className="w-5 h-5 mr-2 text-cyan-400"/> HAWB Details</h3><div className="bg-slate-900/50 p-4 rounded-md space-y-2"><p><strong>HAWB Number:</strong> <span className="font-mono bg-slate-700 px-2 py-1 rounded">{hawb.hawb_number}</span></p><p><strong>Customer:</strong> {hawb.customer}</p><p><strong>Origin:</strong> {hawb.origin}</p><p><strong>Destination:</strong> {hawb.destination}</p><p><strong>Pieces:</strong> {hawb.pieces}</p><p><strong>Actual Weight:</strong> {hawb.actual_weight_kg.toLocaleString()} kg</p><p><strong>Chargeable Weight:</strong> {hawb.chargeable_weight_kg.toLocaleString()} kg</p>{hawb.remarks && <p><strong>Remarks:</strong> <span className="text-amber-300">{hawb.remarks}</span></p>}</div></div>;
        }
    };

    const getIssueLevelColor = (level: ShipmentIssue['level']) => {
        switch (level) {
            case 'critical': return 'border-red-500';
            case 'warning': return 'border-amber-500';
            case 'info': return 'border-sky-500';
            default: return 'border-slate-600';
        }
    }
    
    if (view === 'list') {
        return (
            <div className={`${theme === 'dark' ? 'bg-slate-900 text-slate-300' : 'bg-white text-slate-900'} min-h-screen font-sans p-4`}>
                <header className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Air Cargo Manifests</h1>
                        <p className="text-slate-400">Search and select a manifest to view its details.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-400">Theme</label>
                        <select value={theme} onChange={e => setTheme(e.target.value as any)} className={`${theme==='dark'?'bg-slate-900 border-slate-600 text-slate-200':'bg-white border-slate-300 text-slate-900'} border rounded px-2 py-1 text-sm`}>
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                        </select>
                    </div>
                </header>
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4 mb-4 flex flex-col md:flex-row gap-4">
                    <input type="text" name="manifestNo" value={filters.manifestNo} onChange={handleFilterChange} placeholder="Filter by Manifest #" className="bg-slate-900 border border-slate-600 rounded-md py-2 px-4 text-sm focus:ring-cyan-500 focus:border-cyan-500 w-full" />
                    <input type="text" name="flightNo" value={filters.flightNo} onChange={handleFilterChange} placeholder="Filter by Flight #" className="bg-slate-900 border border-slate-600 rounded-md py-2 px-4 text-sm focus:ring-cyan-500 focus:border-cyan-500 w-full" />
                    <div className="flex items-center gap-2">
                        <select value={filters.sortBy} onChange={handleSortChange} className="bg-slate-900 border border-slate-600 rounded-md py-2 px-4 text-sm focus:ring-cyan-500 focus:border-cyan-500 w-full md:w-auto">
                            <option value="createdAt">Date Created</option>
                            <option value="totalPieces">Total Pieces</option>
                            <option value="totalWeightKg">Total Weight</option>
                        </select>
                        <button onClick={handleSortDirToggle} className="p-2 bg-slate-900 border border-slate-600 rounded-md hover:bg-slate-700">
                            {filters.sortDir === 'asc' ? <ArrowUpIcon className="w-5 h-5"/> : <ArrowDownIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-800 border-b border-slate-700 text-slate-400">
                                <tr>
                                    <th className="p-3">Manifest #</th>
                                    <th className="p-3">Flight #</th>
                                     <th className="p-3">Date</th>
                                    <th className="p-3">Route</th>
                                    <th className="p-3">Pieces</th>
                                    <th className="p-3">Weight (kg)</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {isListLoading ? (
                                    <tr><td colSpan={7} className="p-8 text-center"><LoadingSpinner /></td></tr>
                                ) : manifests.length === 0 && !listError ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-slate-500">No manifests found for the current filters.</td></tr>
                                ) : (
                                    manifests.map(m => (
                                        <tr key={m.id} className="border-b border-slate-800 hover:bg-slate-700/50">
                                            <td className="p-3 font-mono">{m.manifestNo}</td>
                                            <td className="p-3 font-mono">{m.flightNo}</td>
                                            <td className="p-3">{new Date(m.date).toLocaleDateString()}</td>
                                            <td className="p-3">{m.pointOfLoading} &rarr; {m.pointOfUnloading}</td>
                                            <td className="p-3">{m.totalPieces}</td>
                                            <td className="p-3">{parseFloat(m.totalWeightKg).toLocaleString()}</td>
                                            <td className="p-3 text-right">
                                                <button onClick={() => handleViewDetails(m.id)} className="bg-cyan-600 text-white text-xs font-bold py-1 px-3 rounded hover:bg-cyan-500">View Details</button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {!isListLoading && manifests.length > 0 && (
                        <div className="p-3 bg-slate-800/70 flex justify-between items-center text-sm border-t border-slate-700">
                            <button onClick={() => handlePageChange(paginationInfo.page - 1)} disabled={!paginationInfo.hasPrevPage} className="bg-slate-700 text-white font-bold py-1 px-3 rounded hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed">
                                Previous
                            </button>
                            <span className="text-slate-400">Page {paginationInfo.page} of {paginationInfo.totalPages}</span>
                            <button onClick={() => handlePageChange(paginationInfo.page + 1)} disabled={!paginationInfo.hasNextPage} className="bg-slate-700 text-white font-bold py-1 px-3 rounded hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed">
                                Next
                            </button>
                        </div>
                    )}
                </div>
                 <Modal 
                    isOpen={!!listError} 
                    onClose={clearErrors} 
                    title="Error Fetching Manifests"
                >
                    <p className="text-red-400">{listError}</p>
                    <div className="mt-6 flex justify-end">
                        <button 
                            onClick={clearErrors} 
                            className="bg-cyan-600 text-white font-bold py-2 px-4 rounded hover:bg-cyan-500"
                        >
                            Acknowledge
                        </button>
                    </div>
                </Modal>
            </div>
        );
    }

    return (
        <div className={`${theme === 'dark' ? 'bg-slate-900 text-slate-300' : 'bg-white text-slate-900'} min-h-screen font-sans p-4`}>
            <header className="flex justify-between items-center mb-4">
                {currentManifest && (
                    <div className="flex items-center gap-4">
                         <button onClick={handleBackToList} className="text-slate-400 hover:text-white transition-colors" title="Back to list">
                            <ArrowLeftIcon className="w-6 h-6"/>
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Air Cargo Manifest Viewer</h1>
                            <p className="text-slate-400">Manifest #: {currentManifest.manifest_number} | Flight: {currentManifest.flight_details.flight_number}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <label className="text-sm text-slate-400">Theme</label>
                            <select value={theme} onChange={e => setTheme(e.target.value as any)} className={`${theme==='dark'?'bg-slate-900 border-slate-600 text-slate-200':'bg-white border-slate-300 text-slate-900'} border rounded px-2 py-1 text-sm`}>
                                <option value="dark">Dark</option>
                                <option value="light">Light</option>
                            </select>
                        </div>
                    </div>
                )}
            </header>

            {isDetailLoading ? (
                 <div className="flex items-center justify-center h-[calc(100vh-80px)]"><LoadingSpinner /></div>
            ) : currentManifest ? (
                <main className="grid grid-cols-1 md:grid-cols-12 gap-4 h-[calc(100vh-104px)]">
                    <div className="md:col-span-3 flex flex-col h-full bg-slate-800/50 rounded-lg border border-slate-700">
                        <div className="p-4 border-b border-slate-700"><h2 className="text-lg font-semibold text-white">Master Waybills ({filteredShipments.length})</h2><div className="relative mt-2"><input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-md py-2 pl-10 pr-4 text-sm focus:ring-cyan-500 focus:border-cyan-500" placeholder="Search MAWB..." /><SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /></div></div>
                        <div className="flex-grow overflow-y-auto p-2 space-y-1">{filteredShipments.length > 0 ? filteredShipments.map(shipment => (<div key={shipment.awb_number} onClick={() => handleSelectMawb(shipment)} className={`p-3 rounded-md cursor-pointer transition-colors ${selectedMawb?.awb_number === shipment.awb_number ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700'}`}><p className="font-bold text-sm">{shipment.awb_number}</p><p className="text-xs opacity-80">{shipment.pieces} pcs / {shipment.weight.value.toLocaleString()} kg</p><p className="text-xs opacity-60 truncate">{shipment.nature_of_goods}</p></div>)) : <p className="p-4 text-center text-slate-500">No matching MAWBs.</p>}</div>
                    </div>
                    <div className="md:col-span-5 flex flex-col h-full bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                        {selectedMawb ? (<> <div className="p-4 border-b border-slate-700 flex-shrink-0"><div className="flex justify-between items-start"><div><h2 className="text-lg font-semibold text-white">{selectedMawb.awb_number}</h2><p className="text-sm text-slate-400">{selectedMawb.nature_of_goods}</p></div></div></div>

                        <div className="border-b border-slate-700 px-2 flex-shrink-0">
                            <nav className="flex space-x-2">
                                <button onClick={() => setActiveTab('details')} className={`px-3 py-2 text-sm font-medium rounded-t-md ${activeTab === 'details' ? 'border-b-2 border-cyan-400 text-white' : 'text-slate-400 hover:text-white'}`}>Details</button>
                                <button onClick={() => setActiveTab('ulds')} className={`px-3 py-2 text-sm font-medium rounded-t-md ${activeTab === 'ulds' ? 'border-b-2 border-cyan-400 text-white' : 'text-slate-400 hover:text-white'}`}>ULDs ({(selectedMawb.uld_contents || []).length})</button>
                                <button onClick={() => setActiveTab('hawbs')} className={`px-3 py-2 text-sm font-medium rounded-t-md ${activeTab === 'hawbs' ? 'border-b-2 border-cyan-400 text-white' : 'text-slate-400 hover:text-white'}`}>HAWBs ({(selectedMawb.house_shipments || []).length})</button>
                                <button onClick={() => setActiveTab('issues')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-t-md ${activeTab === 'issues' ? 'border-b-2 border-red-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                                    <WarningIcon className="w-4 h-4" /> Issues ({shipmentIssues.length})
                                </button>
                                <button onClick={() => setActiveTab('documents')} className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-t-md ${activeTab === 'documents' ? 'border-b-2 border-cyan-400 text-white' : 'text-slate-400 hover:text-white'}`}>
                                    <DocumentIcon className="w-4 h-4" /> Documents ({uploadedFiles.length})
                                </button>
                            </nav>
                        </div>
                        <div className="flex-grow overflow-y-auto p-4">
                            {activeTab === 'details' && (
                                <div className="space-y-3 text-sm">
                                    <div className="flex items-center"><CubeIcon className="w-4 h-4 mr-2 text-slate-500"/><strong>Pieces:</strong><span className="ml-2">{selectedMawb.pieces}</span></div>
                                    <div className="flex items-center"><ScaleIcon className="w-4 h-4 mr-2 text-slate-500"/><strong>Weight:</strong><span className="ml-2">{selectedMawb.weight.value.toLocaleString()} {selectedMawb.weight.unit}</span></div>
                                    <div className="flex items-center"><InfoIcon className="w-4 h-4 mr-2 text-slate-500"/><strong>SHC:</strong><span className="ml-2 flex flex-wrap gap-1">{selectedMawb.special_handling_codes.map(code => <span key={code} className="bg-slate-700 text-xs px-2 py-1 rounded-full">{code}</span>)}</span></div>
                                    {selectedMawb.storage_instructions && <div className="text-amber-300 bg-amber-900/50 p-2 rounded-md"><strong>Storage:</strong> {selectedMawb.storage_instructions}</div>}
                                </div>
                            )}
                            {activeTab === 'ulds' && (
                                <div className="space-y-1">
                                    {(selectedMawb.uld_contents || []).map((uld, idx) => (
                                        <div key={`${uld.uld_id}-${idx}`} onClick={() => handleSelectItem(uld)} className={`p-2 rounded-md cursor-pointer transition-colors flex justify-between items-center ${selectedItem === uld ? 'bg-slate-600' : 'hover:bg-slate-700/50'}`}>
                                            <div><p className="font-mono text-sm">{uld.uld_id}</p></div>
                                            <div className="text-right text-xs"><p>{uld.pieces} pcs</p><p>{uld.weight.value.toLocaleString()} kg</p></div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {activeTab === 'hawbs' && (
                                <div className="space-y-1">
                                    {(selectedMawb.house_shipments || []).map((hawb, idx) => (
                                        <div key={`${hawb.hawb_number}-${idx}`} onClick={() => handleSelectItem(hawb)} className={`p-2 rounded-md cursor-pointer transition-colors ${selectedItem === hawb ? 'bg-slate-600' : 'hover:bg-slate-700/50'}`}>
                                            <p className="font-mono text-sm">{hawb.hawb_number}</p>
                                            <p className="text-xs opacity-70">{hawb.customer} to {hawb.destination}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {activeTab === 'issues' && (
                                <div className="space-y-4">
                                    {shipmentIssues.length === 0 ? (
                                        <div className="text-slate-400 text-center p-8">
                                            <WarningIcon className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                                            <h3 className="text-lg font-semibold text-white mb-2">No Issues Detected</h3>
                                            <p className="text-sm">The AI assistant has not found any potential issues for this shipment.</p>
                                        </div>
                                    ) : (
                                        shipmentIssues.map(issue => (
                                            <div key={issue.id} className={`p-4 rounded-lg border-l-4 bg-slate-900/50 ${getIssueLevelColor(issue.level)}`}>
                                                <h4 className="font-bold text-white mb-1">{issue.message}</h4>
                                                <p className="text-sm text-slate-400">{issue.suggestion}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                            {activeTab === 'documents' && (
                                <div className="space-y-4">
                                    <FileUpload onFileUpload={handleFileUpload} />
                                    <div className="space-y-2">
                                        <h4 className="text-md font-semibold text-white">Uploaded Files ({uploadedFiles.length})</h4>
                                        {uploadedFiles.length > 0 ? (
                                            <ul className="divide-y divide-slate-700">
                                                {uploadedFiles.map(file => (
                                                    <li key={file.name} className="flex items-center justify-between py-2 text-sm">
                                                        <span className="truncate">{file.name}</span>
                                                        <span className="text-slate-400 text-xs">{(file.size / 1024).toFixed(2)} KB</span>
                                                        <button onClick={() => handleRemoveFile(file.name)} className="p-1 text-slate-500 hover:text-red-400">
                                                            <CloseIcon className="w-4 h-4" />
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-slate-500 text-sm text-center py-4">No documents uploaded for this shipment.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        </>) : (<div className="flex items-center justify-center h-full text-slate-500">Select a MAWB to see details.</div>)}
                    </div>
                    <div className="md:col-span-4 flex flex-col h-full bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
                         <div className="p-4 border-b border-slate-700 flex-shrink-0"><h2 className="text-lg font-semibold text-white">Item Details</h2></div>
                         <div className="flex-grow overflow-y-auto p-4">{renderItemDetails()}</div>
                    </div>
                </main>
            ) : null }

            <Modal 
                isOpen={!!detailError} 
                onClose={clearErrors} 
                title="Error Loading Manifest"
            >
                <p className="text-red-400">{detailError}</p>
                <div className="mt-6 flex justify-end">
                    <button 
                        onClick={() => {
                            clearErrors();
                            handleBackToList();
                        }} 
                        className="bg-cyan-600 text-white font-bold py-2 px-4 rounded hover:bg-cyan-500"
                    >
                        Back to List
                    </button>
                </div>
            </Modal>

            <button onClick={() => setIsChatOpen(true)} className="fixed bottom-4 right-4 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold p-4 rounded-full shadow-lg transition-transform hover:scale-110" title="Open AI Assistant"><ChatBubbleIcon className="w-8 h-8"/></button>
            <ChatAssistant isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} manifestData={currentManifest} selectedMawb={selectedMawb}/>
        </div>
    );
};

export default App;