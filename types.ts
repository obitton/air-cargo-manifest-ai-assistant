export interface Weight {
    value: number;
    unit: string;
}

export interface ULDContent {
    uld_id: string;
    pieces: number;
    weight: Weight;
}

export interface HouseShipment {
    hawb_number: string;
    customer: string;
    origin: string;
    destination: string;
    pieces: number;
    actual_weight_kg: number;
    chargeable_weight_kg: number;
    remarks?: string;
}

export interface Shipment {
    awb_number: string;
    pieces: number;
    weight: Weight;
    nature_of_goods: string;
    special_handling_codes: string[];
    storage_instructions?: string;
    uld_contents: ULDContent[];
    house_shipments: HouseShipment[];
}

export interface FlightDetails {
    flight_number: string;
    departure_airport: string;
    arrival_airport: string;
    departure_date: string;
    arrival_date: string;
}

export interface ManifestData {
    id: string;
    manifest_number: string;
    flight_details: FlightDetails;
    shipments: Shipment[];
    total_pieces: number;
    total_weight: Weight;
}

export type SelectedItem = ULDContent | HouseShipment;

export interface ManifestSummary {
    id: string;
    manifestNo: string;
    flightNo: string;
    date: string;
    pointOfLoading: string;
    pointOfUnloading: string;
    totalPieces: number;
    totalWeightKg: string;
}

export interface GetManifestsResponse {
    docs: ManifestSummary[];
    totalDocs: number;
    limit: number;
    totalPages: number;
    page: number;
    pagingCounter: number;
    hasPrevPage: boolean;
    hasNextPage: boolean;
    prevPage: number | null;
    nextPage: number | null;
}

export interface ManifestFilters {
    manifestNo?: string;
    flightNo?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
}