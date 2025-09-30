import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { ManifestData, Shipment, HouseShipment, ULDContent, SelectedItem, ManifestSummary } from './types';
import { useReactToPrint } from 'react-to-print';
import { SearchIcon, DocumentIcon, CubeIcon, ScaleIcon, InfoIcon, ArrowLeftIcon, ChatBubbleIcon, ArrowUpIcon, ArrowDownIcon, PrinterIcon } from './components/IconComponents';
import ChatAssistant from './components/ChatAssistant';
import { getManifests, getManifestDetails, ManifestFilters } from './services/apiService';
import { debounce } from './utils';
import SkeletonLoader from './components/SkeletonLoader';
import Modal from './components/Modal';
import PrintableSummary from './components/PrintableSummary';

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
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        const savedTheme = localStorage.getItem('theme');
        return (savedTheme === 'light' || savedTheme === 'dark') ? savedTheme : 'dark';
    });

    useEffect(() => {
        localStorage.setItem('theme', theme);
        document.body.dataset.theme = theme;
    }, [theme]);

    // State for the detail view
    const [currentManifest, setCurrentManifest] = useState<ManifestData | null>(null);
    const [selectedMawb, setSelectedMawb] = useState<Shipment | null>(null);
    const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'details' | 'ulds' | 'hawbs'>('details');
    const [isDetailLoading, setIsDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    // State for Chat Assistant
    const [isChatOpen, setIsChatOpen] = useState(false);

    // Print handling
    const printComponentRef = useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({
        content: () => printComponentRef.current,
        documentTitle: `Manifest-Summary-${currentManifest?.manifest_number || ''}`,
    });
    
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
            setListError(`Failed to fetch manifests. The server might be offline or the API endpoint is unavailable. Please check your connection and try again. (Error: ${error.message})`);
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
                setSelectedMawb(firstMawb);
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
            }
        } catch (error: any) {
            setDetailError(`Failed to fetch details for the selected manifest. It might be missing from the database or there was a network issue. Please try again. (Error: ${error.message})`);
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
    };

    const handleSelectMawb = (mawb: Shipment) => {
        setSelectedMawb(mawb);
        setSelectedItem(null);
        setActiveTab('details');
    };

    const handleSelectItem = (item: SelectedItem) => {
        setSelectedItem(item);
    }

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
            return <div className="text-muted-foreground text-center p-8">Select an item from the details panel to see specifics.</div>;
        }
        if ('uld_id' in selectedItem) {
            const uld = selectedItem as ULDContent;
            return <div className="space-y-4"><h3 className="text-lg font-semibold text-foreground flex items-center"><CubeIcon className="w-5 h-5 mr-2 text-primary" /> ULD Details</h3><div className="bg-secondary p-4 rounded-md space-y-2"><p><strong>ID:</strong> <span className="font-mono bg-muted px-2 py-1 rounded">{uld.uld_id}</span></p><p><strong>Pieces:</strong> {uld.pieces}</p><p><strong>Weight:</strong> {uld.weight.value.toLocaleString()} {uld.weight.unit}</p></div></div>;
        } else {
            const hawb = selectedItem as HouseShipment;
            return <div className="space-y-4"><h3 className="text-lg font-semibold text-foreground flex items-center"><DocumentIcon className="w-5 h-5 mr-2 text-primary"/> HAWB Details</h3><div className="bg-secondary p-4 rounded-md space-y-2"><p><strong>HAWB Number:</strong> <span className="font-mono bg-muted px-2 py-1 rounded">{hawb.hawb_number}</span></p><p><strong>Customer:</strong> {hawb.customer}</p><p><strong>Origin:</strong> {hawb.origin}</p><p><strong>Destination:</strong> {hawb.destination}</p><p><strong>Pieces:</strong> {hawb.pieces}</p><p><strong>Actual Weight:</strong> {hawb.actual_weight_kg.toLocaleString()} kg</p><p><strong>Chargeable Weight:</strong> {hawb.chargeable_weight_kg.toLocaleString()} kg</p>{hawb.remarks && <p><strong>Remarks:</strong> <span className="text-amber-500">{hawb.remarks}</span></p>}</div></div>;
        }
    };
    
    if (view === 'list') {
        return (
            <div className="min-h-screen font-sans p-4 bg-background text-foreground">
                <header className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-bold">Air Cargo Manifests</h1>
                        <p className="text-muted-foreground">Search and select a manifest to view its details.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground">Theme</label>
                        <select value={theme} onChange={e => setTheme(e.target.value as any)} className="bg-background border border-border rounded px-2 py-1 text-sm focus:ring-ring focus:border-ring">
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                        </select>
                    </div>
                </header>
                <div className="bg-card border border-border rounded-lg p-4 mb-4 flex flex-col md:flex-row gap-4">
                    <input type="text" name="manifestNo" value={filters.manifestNo} onChange={handleFilterChange} placeholder="Filter by Manifest #" className="bg-background border border-input rounded-md py-2 px-4 text-sm focus:ring-ring focus:border-ring w-full" />
                    <input type="text" name="flightNo" value={filters.flightNo} onChange={handleFilterChange} placeholder="Filter by Flight #" className="bg-background border border-input rounded-md py-2 px-4 text-sm focus:ring-ring focus:border-ring w-full" />
                    <div className="flex items-center gap-2">
                        <select value={filters.sortBy} onChange={handleSortChange} className="bg-background border border-input rounded-md py-2 px-4 text-sm focus:ring-ring focus:border-ring w-full md:w-auto">
                            <option value="createdAt">Date Created</option>
                            <option value="totalPieces">Total Pieces</option>
                            <option value="totalWeightKg">Total Weight</option>
                        </select>
                        <button onClick={handleSortDirToggle} className="p-2 bg-secondary text-secondary-foreground border border-input rounded-md hover:bg-accent">
                            {filters.sortDir === 'asc' ? <ArrowUpIcon className="w-5 h-5"/> : <ArrowDownIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
                <div className="bg-card rounded-lg border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/50 border-b border-border">
                                <tr>
                                    <th className="p-3 text-muted-foreground">Manifest #</th>
                                    <th className="p-3 text-muted-foreground">Flight #</th>
                                     <th className="p-3 text-muted-foreground">Date</th>
                                    <th className="p-3 text-muted-foreground">Route</th>
                                    <th className="p-3 text-muted-foreground">Pieces</th>
                                    <th className="p-3 text-muted-foreground">Weight (kg)</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {isListLoading ? (
                                    <SkeletonLoader rows={filters.pageSize} />
                                ) : manifests.length === 0 && !listError ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No manifests found for the current filters.</td></tr>
                                ) : (
                                    manifests.map(m => (
                                        <tr key={m.id} className="border-b border-border hover:bg-muted/50">
                                            <td className="p-3 font-mono">{m.manifestNo}</td>
                                            <td className="p-3 font-mono">{m.flightNo}</td>
                                            <td className="p-3">{new Date(m.date).toLocaleDateString()}</td>
                                            <td className="p-3">{m.pointOfLoading} &rarr; {m.pointOfUnloading}</td>
                                            <td className="p-3">{m.totalPieces}</td>
                                            <td className="p-3">{parseFloat(m.totalWeightKg).toLocaleString()}</td>
                                            <td className="p-3 text-right">
                                                <button onClick={() => handleViewDetails(m.id)} className="bg-primary text-primary-foreground text-xs font-bold py-1 px-3 rounded hover:bg-primary/90">View Details</button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {!isListLoading && manifests.length > 0 && (
                        <div className="p-3 bg-muted/50 flex justify-between items-center text-sm border-t border-border">
                            <button onClick={() => handlePageChange(paginationInfo.page - 1)} disabled={!paginationInfo.hasPrevPage} className="bg-secondary text-secondary-foreground font-bold py-1 px-3 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed">
                                Previous
                            </button>
                            <span className="text-muted-foreground">Page {paginationInfo.page} of {paginationInfo.totalPages}</span>
                            <button onClick={() => handlePageChange(paginationInfo.page + 1)} disabled={!paginationInfo.hasNextPage} className="bg-secondary text-secondary-foreground font-bold py-1 px-3 rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed">
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
                    <p className="text-destructive">{listError}</p>
                    <div className="mt-6 flex justify-end">
                        <button 
                            onClick={clearErrors} 
                            className="bg-primary text-primary-foreground font-bold py-2 px-4 rounded hover:bg-primary/90"
                        >
                            Acknowledge
                        </button>
                    </div>
                </Modal>
            </div>
        );
    }

    return (
        <div className="min-h-screen font-sans p-4 bg-background text-foreground">
            <header className="flex justify-between items-center mb-4">
                {currentManifest && (
                    <div className="flex items-center gap-4 flex-grow">
                         <button onClick={handleBackToList} className="text-muted-foreground hover:text-foreground transition-colors" title="Back to list">
                            <ArrowLeftIcon className="w-6 h-6"/>
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold">Air Cargo Manifest Viewer</h1>
                            <p className="text-muted-foreground">Manifest #: {currentManifest.manifest_number} | Flight: {currentManifest.flight_details.flight_number}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-accent text-sm">
                                <PrinterIcon className="w-4 h-4" />
                                <span>Print</span>
                            </button>
                            <label className="text-sm text-muted-foreground">Theme</label>
                            <select value={theme} onChange={e => setTheme(e.target.value as any)} className="bg-background border border-input rounded px-2 py-1 text-sm focus:ring-ring focus:border-ring">
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
                    <div className="md:col-span-3 flex flex-col h-full bg-card rounded-lg border border-border">
                        <div className="p-4 border-b border-border"><h2 className="text-lg font-semibold">Master Waybills ({filteredShipments.length})</h2><div className="relative mt-2"><input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-background border border-input rounded-md py-2 pl-10 pr-4 text-sm focus:ring-ring focus:border-ring" placeholder="Search MAWB..." /><SearchIcon className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" /></div></div>
                        <div className="flex-grow overflow-y-auto p-2 space-y-1">{filteredShipments.length > 0 ? filteredShipments.map(shipment => (<div key={shipment.awb_number} onClick={() => handleSelectMawb(shipment)} className={`p-3 rounded-md cursor-pointer transition-colors ${selectedMawb?.awb_number === shipment.awb_number ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}><p className="font-bold text-sm">{shipment.awb_number}</p><p className="text-xs opacity-80">{shipment.pieces} pcs / {shipment.weight.value.toLocaleString()} kg</p><p className="text-xs opacity-60 truncate">{shipment.nature_of_goods}</p></div>)) : <p className="p-4 text-center text-muted-foreground">No matching MAWBs.</p>}</div>
                    </div>
                    <div className="md:col-span-5 flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
                        {selectedMawb ? (<> <div className="p-4 border-b border-border flex-shrink-0"><div className="flex justify-between items-start"><div><h2 className="text-lg font-semibold">{selectedMawb.awb_number}</h2><p className="text-sm text-muted-foreground">{selectedMawb.nature_of_goods}</p></div></div></div><div className="border-b border-border px-2 flex-shrink-0"><nav className="flex space-x-2"><button onClick={() => setActiveTab('details')} className={`px-3 py-2 text-sm font-medium ${activeTab === 'details' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Details</button><button onClick={() => setActiveTab('ulds')} className={`px-3 py-2 text-sm font-medium ${activeTab === 'ulds' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>ULDs ({(selectedMawb.uld_contents || []).length})</button><button onClick={() => setActiveTab('hawbs')} className={`px-3 py-2 text-sm font-medium ${activeTab === 'hawbs' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>HAWBs ({(selectedMawb.house_shipments || []).length})</button></nav></div><div className="flex-grow overflow-y-auto p-4">{activeTab === 'details' && (<div className="space-y-3 text-sm"><div className="flex items-center"><CubeIcon className="w-4 h-4 mr-2 text-muted-foreground"/><strong>Pieces:</strong><span className="ml-2">{selectedMawb.pieces}</span></div><div className="flex items-center"><ScaleIcon className="w-4 h-4 mr-2 text-muted-foreground"/><strong>Weight:</strong><span className="ml-2">{selectedMawb.weight.value.toLocaleString()} {selectedMawb.weight.unit}</span></div><div className="flex items-center"><InfoIcon className="w-4 h-4 mr-2 text-muted-foreground"/><strong>SHC:</strong><span className="ml-2 flex flex-wrap gap-1">{selectedMawb.special_handling_codes.map(code => <span key={code} className="bg-muted text-muted-foreground text-xs px-2 py-1 rounded-full">{code}</span>)}</span></div>{selectedMawb.storage_instructions && <div className="text-amber-600 dark:text-amber-400 bg-amber-500/20 p-2 rounded-md"><strong>Storage:</strong> {selectedMawb.storage_instructions}</div>}</div>)}{activeTab === 'ulds' && (<div className="space-y-1">{(selectedMawb.uld_contents || []).map((uld, idx) => ( <div key={`${uld.uld_id}-${idx}`} onClick={() => handleSelectItem(uld)} className={`p-2 rounded-md cursor-pointer transition-colors flex justify-between items-center ${selectedItem === uld ? 'bg-secondary' : 'hover:bg-accent'}`}><div><p className="font-mono text-sm">{uld.uld_id}</p></div><div className="text-right text-xs"><p>{uld.pieces} pcs</p><p>{uld.weight.value.toLocaleString()} kg</p></div></div>))}</div>)}{activeTab === 'hawbs' && (<div className="space-y-1">{(selectedMawb.house_shipments || []).map((hawb, idx) => ( <div key={`${hawb.hawb_number}-${idx}`} onClick={() => handleSelectItem(hawb)} className={`p-2 rounded-md cursor-pointer transition-colors ${selectedItem === hawb ? 'bg-secondary' : 'hover:bg-accent'}`}><p className="font-mono text-sm">{hawb.hawb_number}</p><p className="text-xs text-muted-foreground">{hawb.customer} to {hawb.destination}</p></div>))}</div>)}</div></>) : (<div className="flex items-center justify-center h-full text-muted-foreground">Select a MAWB to see details.</div>)}
                    </div>
                    <div className="md:col-span-4 flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
                         <div className="p-4 border-b border-border flex-shrink-0"><h2 className="text-lg font-semibold">Item Details</h2></div>
                         <div className="flex-grow overflow-y-auto p-4">{renderItemDetails()}</div>
                    </div>
                </main>
            ) : null }

            <Modal 
                isOpen={!!detailError} 
                onClose={clearErrors} 
                title="Error Loading Manifest Details"
            >
                <p className="text-destructive">{detailError}</p>
                <div className="mt-6 flex justify-end">
                    <button 
                        onClick={() => {
                            clearErrors();
                            handleBackToList();
                        }} 
                        className="bg-primary text-primary-foreground font-bold py-2 px-4 rounded hover:bg-primary/90"
                    >
                        Back to List
                    </button>
                </div>
            </Modal>

            <div style={{ display: 'none' }}>
                <PrintableSummary ref={printComponentRef} manifestData={currentManifest} />
            </div>

            <button onClick={() => setIsChatOpen(true)} className="fixed bottom-4 right-4 bg-primary text-primary-foreground p-4 rounded-full shadow-lg transition-transform hover:scale-110" title="Open AI Assistant"><ChatBubbleIcon className="w-8 h-8"/></button>
            <ChatAssistant isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} manifestData={currentManifest} selectedMawb={selectedMawb}/>
        </div>
    );
};

export default App;