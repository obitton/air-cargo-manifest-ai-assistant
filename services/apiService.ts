import type { GetManifestsResponse, ManifestData, ManifestFilters, Shipment, ULDContent, HouseShipment, Weight } from '../types';

// This service handles communication from the browser. In dev it proxies directly
// to the external API via Vite's server.proxy. In production it hits our serverless
// function under /api which adds the Authorization header.
const API_BASE_URL = '/api';

export { ManifestFilters };

function buildManifestsQuery(filters: ManifestFilters): string {
    const params = new URLSearchParams();
    if (filters.manifestNo) params.append('manifestNo', filters.manifestNo);
    if (filters.flightNo) params.append('flightNo', filters.flightNo);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if ((filters as any).pointOfLoading) params.append('pointOfLoading', (filters as any).pointOfLoading);
    if ((filters as any).pointOfUnloading) params.append('pointOfUnloading', (filters as any).pointOfUnloading);
    if ((filters as any).ownerOrOperator) params.append('ownerOrOperator', (filters as any).ownerOrOperator);
    if ((filters as any).registration) params.append('registration', (filters as any).registration);

    params.append('page', (filters.page || 1).toString());
    params.append('pageSize', (filters.pageSize || 25).toString());
    params.append('sortBy', filters.sortBy || 'createdAt');
    params.append('sortDir', filters.sortDir || 'desc');
    return params.toString();
}

export const getManifests = async (filters: ManifestFilters): Promise<GetManifestsResponse> => {
    const qs = buildManifestsQuery(filters);
    const response = await fetch(`${API_BASE_URL}/get-manifests?${qs}`, {
        method: 'GET'
    });

    if (!response.ok) {
        let message = 'Unknown error fetching manifests';
        try {
            const err = await response.json();
            message = err.message || message;
        } catch {}
        throw new Error(message);
    }

    return response.json();
};

function asNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function transformManifest(apiData: any): ManifestData {
    console.log("--- Starting Manifest Transformation ---");
    console.log("Received raw API data:", apiData);

    const doc = apiData?.doc ?? apiData;
    const manifestInfo = doc?.manifest ?? {};
    const containers: any[] = Array.isArray(doc?.containers) ? doc.containers : [];

    console.log("Parsed manifestInfo:", manifestInfo);
    console.log(`Found ${containers.length} containers.`);

    const departureAirport: string = manifestInfo.pointOfLoading ?? '';
    const arrivalAirport: string = manifestInfo.pointOfUnloading ?? '';

    type Accumulator = {
        totalPieces: number;
        totalWeightKg: number;
        uldIdToTotals: Map<string, { pieces: number; weightKg: number }>;
        houseShipments: HouseShipment[];
        natureOfGoods: string;
        shcs: Set<string>;
    };

    const shipmentsByAwb: Map<string, Accumulator> = new Map();

    const topLevelMasterbills: any[] = Array.isArray((doc as any)?.masterbills) ? (doc as any).masterbills : [];
    const topLevelHousebills: any[] = Array.isArray((doc as any)?.housebills) ? (doc as any).housebills : [];
    console.log('Top-level masterbills length:', Array.isArray(topLevelMasterbills) ? topLevelMasterbills.length : 'N/A');
    console.log('Top-level housebills length:', Array.isArray(topLevelHousebills) ? topLevelHousebills.length : 'N/A');

    let processedMasterbills = 0;

    for (const [i, container] of containers.entries()) {
        const uldId: string = (container as any)?.containerNumber ?? 'N/A';
        console.log(`\n[Container ${i+1}/${containers.length}] Processing ULD ID: ${uldId}`);
        console.log('  - Container keys:', Object.keys(container || {}));

        // Be resilient: masterbills may be under different keys or shapes
        let masterbills: any[] = [];
        if (Array.isArray((container as any)?.masterbills)) masterbills = (container as any).masterbills;
        else if (Array.isArray((container as any)?.masterbill)) masterbills = (container as any).masterbill;
        else {
            // Try to discover an array property that looks like masterbills
            for (const [key, value] of Object.entries(container || {})) {
                if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
                    const sample = value[0] as any;
                    if ('masterbillNumber' in sample || 'housebills' in sample || 'pieces' in sample) {
                        console.warn(`  - Discovered masterbills under key '${key}' by heuristic.`);
                        masterbills = value as any[];
                        break;
                    }
                }
            }
        }

        console.log(`  - Found ${masterbills.length} candidate masterbills in this container.`);
        processedMasterbills += masterbills.length;

        for (const [j, masterbill] of masterbills.entries()) {
            const awbNumber: string = (masterbill as any)?.masterbillNumber ?? '';
            if (!awbNumber) {
                console.warn(`  - Skipping masterbill ${j+1} due to missing AWB number. Keys:`, Object.keys(masterbill || {}));
                continue;
            }
            console.log(`  [MAWB ${j+1}/${masterbills.length}] Processing AWB: ${awbNumber}`);

            const piecesArray: any[] = Array.isArray((masterbill as any)?.pieces) ? (masterbill as any).pieces : [];
            const housebills: any[] = Array.isArray((masterbill as any)?.housebills) ? (masterbill as any).housebills : [];
            
            const shcs: string[] = Array.isArray((masterbill as any)?.shcs) ? (masterbill as any).shcs.map((s: any) => String(s?.code ?? '')) : [];

            // Derive counts and weight
            const piecesCount = piecesArray.length > 0
                ? piecesArray.length
                : housebills.reduce((sum, hb) => sum + (Array.isArray(hb?.pieces) ? hb.pieces.length : 0), 0);
            const totalHouseWeight = housebills.reduce((sum, hb) => {
                const list = Array.isArray(hb?.pieces) ? hb.pieces : [];
                return sum + list.reduce((s, p) => s + asNumber(p?.weight), 0);
            }, 0);

            console.log(`    - Calculated pieces: ${piecesCount}, total HAWB pieces weight: ${totalHouseWeight}kg.`);
            if (shcs.length) console.log(`    - Found ${shcs.length} SHCs: ${shcs.join(', ')}`);

            const isNewAwb = !shipmentsByAwb.has(awbNumber);
            const existing = shipmentsByAwb.get(awbNumber) ?? {
                totalPieces: 0,
                totalWeightKg: 0,
                uldIdToTotals: new Map<string, { pieces: number; weightKg: number }>(),
                houseShipments: [] as HouseShipment[],
                natureOfGoods: (masterbill as any)?.natureOfGoods ?? '',
                shcs: new Set<string>()
            };
            if (isNewAwb) {
                console.log(`    - New AWB detected. Initializing with nature of goods: "${existing.natureOfGoods}"`);
            }

            existing.totalPieces += piecesCount;
            existing.totalWeightKg += totalHouseWeight;
            shcs.forEach(code => existing.shcs.add(code));

            // Build ULD piece counts from masterbill.pieces; if absent, attribute all to current container
            const uldPieceCounts = new Map<string, number>();
            if (piecesArray.length > 0) {
                for (const p of piecesArray) {
                    const uldFromPiece: string = (p as any)?.containerNumber ?? uldId;
                    const prev = uldPieceCounts.get(uldFromPiece) ?? 0;
                    uldPieceCounts.set(uldFromPiece, prev + 1);
                }
            } else {
                // Fallback: assume all pieces in this masterbill are in this container
                uldPieceCounts.set(uldId, (uldPieceCounts.get(uldId) ?? 0) + piecesCount);
            }

            // Allocate weight proportionally across ULDs by piece counts
            const totalPiecesForAllocation = Array.from(uldPieceCounts.values()).reduce((a, b) => a + b, 0) || 1;
            for (const [uld, pcs] of uldPieceCounts.entries()) {
                const uldTotals = existing.uldIdToTotals.get(uld) ?? { pieces: 0, weightKg: 0 };
                uldTotals.pieces += pcs;
                const share = (pcs / totalPiecesForAllocation) * totalHouseWeight;
                uldTotals.weightKg += share;
                existing.uldIdToTotals.set(uld, uldTotals);
                console.log(`    - ULD ${uld}: +${pcs} pcs, +${share.toFixed(2)}kg (allocated).`);
            }

            for (const [k, hb] of housebills.entries()) {
                const hbPieces: any[] = Array.isArray(hb?.pieces) ? hb.pieces : [];
                const hbPieceCount = hbPieces.length;
                const hbWeight = hbPieces.reduce((sum, p) => sum + asNumber(p?.weight), 0);
                const hawbNumber = hb?.housebillNumber ?? `(HB ${k+1})`;
                console.log(`      [HAWB ${k+1}/${housebills.length}] HAWB #${hawbNumber}: ${hbPieceCount} pcs, ${hbWeight}kg.`);
                const hs: HouseShipment = {
                    hawb_number: hb?.housebillNumber ?? '',
                    customer: (hb?.customer ?? '') as string,
                    origin: departureAirport,
                    destination: arrivalAirport,
                    pieces: hbPieceCount,
                    actual_weight_kg: hbWeight,
                    chargeable_weight_kg: hbWeight,
                    remarks: hb?.remarks ?? undefined
                };
                existing.houseShipments.push(hs);
            }

            shipmentsByAwb.set(awbNumber, existing);
            console.log(`    - AWB ${awbNumber} totals updated: ${existing.totalPieces} pcs, ${existing.totalWeightKg}kg.`);
        }
    }

    // Fallback: if we didn't process any masterbills from containers, try top-level
    if (processedMasterbills === 0 && Array.isArray(topLevelMasterbills) && topLevelMasterbills.length > 0) {
        console.warn('Container-level masterbills empty; falling back to top-level doc.masterbills.');
        for (const [j, masterbill] of topLevelMasterbills.entries()) {
            const awbNumber: string = (masterbill as any)?.masterbillNumber ?? '';
            if (!awbNumber) {
                console.warn(`  - Skipping top-level masterbill ${j+1} due to missing AWB number.`);
                continue;
            }
            const piecesArray: any[] = Array.isArray((masterbill as any)?.pieces) ? (masterbill as any).pieces : [];
            const housebills: any[] = Array.isArray((masterbill as any)?.housebills) ? (masterbill as any).housebills : [];

            const piecesCount = piecesArray.length > 0
                ? piecesArray.length
                : housebills.reduce((sum, hb) => sum + (Array.isArray(hb?.pieces) ? hb.pieces.length : 0), 0);
            const totalHouseWeight = housebills.reduce((sum, hb) => {
                const list = Array.isArray(hb?.pieces) ? hb.pieces : [];
                return sum + list.reduce((s, p) => s + asNumber(p?.weight), 0);
            }, 0);

            const existing = shipmentsByAwb.get(awbNumber) ?? {
                totalPieces: 0,
                totalWeightKg: 0,
                uldIdToTotals: new Map<string, { pieces: number; weightKg: number }>(),
                houseShipments: [] as HouseShipment[],
                natureOfGoods: (masterbill as any)?.natureOfGoods ?? '',
                shcs: new Set<string>()
            };

            existing.totalPieces += piecesCount;
            existing.totalWeightKg += totalHouseWeight;

            // Allocate ULDs from pieces' containerNumber if present
            const uldPieceCounts = new Map<string, number>();
            if (piecesArray.length > 0) {
                for (const p of piecesArray) {
                    const uldFromPiece: string = (p as any)?.containerNumber ?? 'UNKNOWN-ULD';
                    const prev = uldPieceCounts.get(uldFromPiece) ?? 0;
                    uldPieceCounts.set(uldFromPiece, prev + 1);
                }
            } else {
                uldPieceCounts.set('UNKNOWN-ULD', (uldPieceCounts.get('UNKNOWN-ULD') ?? 0) + piecesCount);
            }
            const totalPiecesForAllocation = Array.from(uldPieceCounts.values()).reduce((a, b) => a + b, 0) || 1;
            for (const [uld, pcs] of uldPieceCounts.entries()) {
                const uldTotals = existing.uldIdToTotals.get(uld) ?? { pieces: 0, weightKg: 0 };
                uldTotals.pieces += pcs;
                const share = (pcs / totalPiecesForAllocation) * totalHouseWeight;
                uldTotals.weightKg += share;
                existing.uldIdToTotals.set(uld, uldTotals);
            }

            for (const hb of housebills) {
                const hbPieces: any[] = Array.isArray(hb?.pieces) ? hb.pieces : [];
                const hbPieceCount = hbPieces.length;
                const hbWeight = hbPieces.reduce((sum, p) => sum + asNumber(p?.weight), 0);
                const hs: HouseShipment = {
                    hawb_number: hb?.housebillNumber ?? '',
                    customer: (hb?.customer ?? '') as string,
                    origin: departureAirport,
                    destination: arrivalAirport,
                    pieces: hbPieceCount,
                    actual_weight_kg: hbWeight,
                    chargeable_weight_kg: hbWeight,
                    remarks: hb?.remarks ?? undefined
                };
                existing.houseShipments.push(hs);
            }

            shipmentsByAwb.set(awbNumber, existing);
        }
    }

    console.log("\n--- Aggregation Complete ---");
    console.log("Final aggregated shipments by AWB:", Object.fromEntries(shipmentsByAwb));

    const shipments: Shipment[] = Array.from(shipmentsByAwb.entries()).map(([awbNumber, acc]) => {
        const uld_contents: ULDContent[] = Array.from(acc.uldIdToTotals.entries()).map(([uldId, totals]) => ({
            uld_id: uldId,
            pieces: totals.pieces,
            weight: { value: totals.weightKg, unit: 'kg' } as Weight
        }));

        return {
            awb_number: awbNumber,
            pieces: acc.totalPieces,
            weight: { value: acc.totalWeightKg, unit: 'kg' },
            nature_of_goods: acc.natureOfGoods,
            special_handling_codes: Array.from(acc.shcs),
            storage_instructions: undefined,
            uld_contents,
            house_shipments: acc.houseShipments
        } as Shipment;
    });

    console.log("Transformed shipments array:", shipments);

    const totalPieces = shipments.reduce((sum, s) => sum + (s.pieces || 0), 0);
    const totalWeight = shipments.reduce((sum, s) => sum + asNumber(s.weight?.value), 0);

    const manifestData: ManifestData = {
        id: String(manifestInfo.id ?? manifestInfo.manifestNo ?? ''),
        manifest_number: String(manifestInfo.manifestNo ?? ''),
        flight_details: {
            flight_number: String(manifestInfo.flightNo ?? ''),
            departure_airport: departureAirport,
            arrival_airport: arrivalAirport,
            departure_date: String(manifestInfo.date ?? ''),
            arrival_date: ''
        },
        shipments,
        total_pieces: totalPieces,
        total_weight: { value: totalWeight, unit: 'kg' }
    };

    console.log("--- Final Transformed Manifest Data ---");
    console.log(manifestData);
    return manifestData;
}

export const getManifestDetails = async (manifestId: string): Promise<ManifestData> => {
    const response = await fetch(`${API_BASE_URL}/get-manifest?manifestId=${encodeURIComponent(manifestId)}`, {
        method: 'GET'
    });

    if (!response.ok) {
        let message = `Unknown error fetching details for manifest ID ${manifestId}`;
        try {
            const err = await response.json();
            message = err.message || message;
        } catch {}
        throw new Error(message);
    }

    const raw = await response.json();
    return transformManifest(raw);
};