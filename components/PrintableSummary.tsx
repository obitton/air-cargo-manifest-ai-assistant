import React, { forwardRef } from 'react';
import type { ManifestData } from '../types';

interface PrintableSummaryProps {
    manifestData: ManifestData | null;
}

const PrintableSummary = forwardRef<HTMLDivElement, PrintableSummaryProps>(({ manifestData }, ref) => {
    if (!manifestData) {
        return <div ref={ref}>No data to print.</div>;
    }

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans">
            <style type="text/css" media="print">
                {`
                    @page { size: auto; margin: 20mm; }
                    body { -webkit-print-color-adjust: exact; }
                `}
            </style>
            <div className="text-center mb-8">
                <h1 className="text-2xl font-bold">Air Cargo Manifest Summary</h1>
            </div>
            <div className="space-y-6">
                <div>
                    <h2 className="text-lg font-semibold border-b pb-2 mb-2">Manifest Details</h2>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                        <p><strong>Manifest #:</strong> {manifestData.manifest_number}</p>
                        <p><strong>Flight #:</strong> {manifestData.flight_details.flight_number}</p>
                        <p><strong>Route:</strong> {manifestData.flight_details.departure_airport} &rarr; {manifestData.flight_details.arrival_airport}</p>
                        <p><strong>Date:</strong> {new Date(manifestData.flight_details.departure_date).toLocaleDateString()}</p>
                        <p><strong>Total Pieces:</strong> {manifestData.total_pieces.toLocaleString()}</p>
                        <p><strong>Total Weight:</strong> {manifestData.total_weight.value.toLocaleString()} {manifestData.total_weight.unit}</p>
                    </div>
                </div>
                <div>
                    <h2 className="text-lg font-semibold border-b pb-2 mb-2">Shipments</h2>
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="text-left p-2">MAWB #</th>
                                <th className="text-left p-2">Nature of Goods</th>
                                <th className="text-right p-2">Pieces</th>
                                <th className="text-right p-2">Weight ({manifestData.total_weight.unit})</th>
                            </tr>
                        </thead>
                        <tbody>
                            {manifestData.shipments.map(s => (
                                <tr key={s.awb_number} className="border-b">
                                    <td className="p-2 font-mono">{s.awb_number}</td>
                                    <td className="p-2">{s.nature_of_goods}</td>
                                    <td className="p-2 text-right">{s.pieces.toLocaleString()}</td>
                                    <td className="p-2 text-right">{s.weight.value.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
});

export default PrintableSummary;