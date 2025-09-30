import type { Shipment } from './types';

export const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Parameters<F>) => {
        if (timeout !== null) {
            clearTimeout(timeout);
            timeout = null;
        }
        timeout = setTimeout(() => func(...args), waitFor);
    };

    return debounced as (...args: Parameters<F>) => void;
};

export interface ShipmentIssue {
    id: string;
    level: 'warning' | 'info' | 'critical';
    message: string;
    suggestion: string;
}

export const analyzeShipment = (shipment: Shipment): ShipmentIssue[] => {
    const issues: ShipmentIssue[] = [];
    const vagueGoodsDescriptions = ['general cargo', 'consolidated', 'goods', 'samples'];

    // Rule 1: Check for vague 'nature of goods'
    if (vagueGoodsDescriptions.some(vagueDesc => shipment.nature_of_goods.toLowerCase().includes(vagueDesc))) {
        issues.push({
            id: `issue-nog-${shipment.awb_number}`,
            level: 'warning',
            message: 'Vague "Nature of Goods" description.',
            suggestion: 'Consider providing a more detailed description to avoid potential customs delays. For example, instead of "Samples", specify "Apparel Samples".'
        });
    }

    // Rule 2: Check for special handling codes that need attention
    if (shipment.special_handling_codes.includes('AVI')) {
        issues.push({
            id: `issue-avi-${shipment.awb_number}`,
            level: 'info',
            message: 'Shipment contains live animals (AVI).',
            suggestion: 'Ensure all IATA Live Animals Regulations (LAR) documentation is complete and attached. Verify container is compliant.'
        });
    }

    if (shipment.special_handling_codes.includes('DGR')) {
         issues.push({
            id: `issue-dgr-${shipment.awb_number}`,
            level: 'critical',
            message: 'Dangerous Goods (DGR) detected.',
            suggestion: 'Verify the Shipper\'s Declaration for Dangerous Goods is accurate and that all packaging and labeling requirements are met.'
        });
    }

    // Rule 3: Check for missing storage instructions on temperature-sensitive goods
    if (shipment.special_handling_codes.includes('PIL') && !shipment.storage_instructions) {
         issues.push({
            id: `issue-pil-${shipment.awb_number}`,
            level: 'warning',
            message: 'Perishable goods (PIL) have no storage instructions.',
            suggestion: 'Add specific temperature range and storage instructions to prevent spoilage and ensure compliance.'
        });
    }

    // Rule 4: Check for high value cargo
    if (shipment.house_shipments.some(h => h.remarks?.toLowerCase().includes('high value'))) {
         issues.push({
            id: `issue-val-${shipment.awb_number}`,
            level: 'info',
            message: 'High-value cargo detected in HAWB remarks.',
            suggestion: 'Confirm if special security arrangements (e.g., "Secure Storage") are required and in place.'
        });
    }

    return issues;
};