import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import type { ManifestFilters } from '../types';
import path from 'path';
import dotenv from 'dotenv';

// Ensure env vars load in local dev (Vercel loads them automatically in prod)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

/**
 * This is the server-side "Backend-for-Frontend" (BFF) proxy.
 *
 * Why this file exists:
 * 1.  SECURITY: The browser (client-side) makes requests to this function. This function then
 *     adds the secret API_KEY and forwards the request to the actual external API
 *     (https://qa-pld.lnc-live.com). This ensures the API_KEY is never exposed to the public.
 * 2.  CONTROL: It allows us to control and format the requests to the external API from one central place.
 *
 * REQUEST FLOW:
 * Browser --- (fetch '/api/get-manifests') ---> This Server Function --- (secure fetch with API_KEY) ---> External API
 */

const API_BASE_URL = 'https://qa-pld.lnc-live.com/api';

if (!process.env.MANIFEST_API_KEY) {
    throw new Error("MANIFEST_API_KEY environment variable not set for API service");
}

/**
 * A centralized helper to fetch data from the external API and forward the response.
 * @param url The target API URL to fetch.
 * @param res The VercelResponse object to send the response with.
 * @param headers The headers to use for the request.
 */
async function fetchFromApi(url: string, res: VercelResponse, headers: HeadersInit) {
    try {
        const apiResponse = await fetch(url, {
            method: 'GET', // The external API always uses GET for these endpoints
            headers,
        });

        if (!apiResponse.ok) {
            // Try to parse the error from the external API and forward it
            const errorBody = await apiResponse.text();
            console.error(`External API Error (${apiResponse.status}):`, errorBody);
            res.status(apiResponse.status).json({ message: `Error from external API: ${apiResponse.statusText}`, details: errorBody });
            return;
        }

        const data = await apiResponse.json();

        // Forward the successful status code and response body from the target API
        res.status(apiResponse.status).json(data);

    } catch (error: any)
        {
        console.error(`Error fetching from API url ${url}:`, error);
        res.status(500).json({ message: 'An error occurred while calling the backend API.', error: error.message });
    }
}

/**
 * Handles API requests from the frontend, acting as a secure backend-for-frontend (BFF).
 * It constructs the appropriate external API calls based on the endpoint hit.
 */
export default async function handle(req: VercelRequest, res: VercelResponse) {
    // Allow both POST (old client) and GET (new client/proxy) methods
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).end('Method Not Allowed');
    }

    const requestUrl = new URL(req.url!, `http://${req.headers.host}`);
    const path = requestUrl.pathname.replace(/^\/api/, '');

    if (path === '/get-manifests') {
        // Support reading filters from either body (POST) or query (GET)
        const body = (req as any).body;
        let filters: ManifestFilters = {} as ManifestFilters;
        try {
            filters = (typeof body === 'string' ? JSON.parse(body || '{}') : (body || {})) as ManifestFilters;
        } catch {}

        // Overlay query params if present
        const q = requestUrl.searchParams;
        if (q.get('manifestNo')) filters.manifestNo = q.get('manifestNo') || '';
        if (q.get('flightNo')) filters.flightNo = q.get('flightNo') || '';
        if (q.get('dateFrom')) (filters as any).dateFrom = q.get('dateFrom') || '';
        if (q.get('dateTo')) (filters as any).dateTo = q.get('dateTo') || '';
        if (q.get('pointOfLoading')) (filters as any).pointOfLoading = q.get('pointOfLoading') || '';
        if (q.get('pointOfUnloading')) (filters as any).pointOfUnloading = q.get('pointOfUnloading') || '';
        if (q.get('ownerOrOperator')) (filters as any).ownerOrOperator = q.get('ownerOrOperator') || '';
        if (q.get('registration')) (filters as any).registration = q.get('registration') || '';
        if (q.get('page')) filters.page = Number(q.get('page')!);
        if (q.get('pageSize')) filters.pageSize = Number(q.get('pageSize')!);
        if (q.get('sortBy')) filters.sortBy = q.get('sortBy') || 'createdAt';
        if (q.get('sortDir')) filters.sortDir = q.get('sortDir') as any || 'desc';

        const params = new URLSearchParams();
        if (filters.manifestNo) params.append('manifestNo', filters.manifestNo);
        if (filters.flightNo) params.append('flightNo', filters.flightNo);
        if ((filters as any).dateFrom) params.append('dateFrom', (filters as any).dateFrom);
        if ((filters as any).dateTo) params.append('dateTo', (filters as any).dateTo);
        if ((filters as any).pointOfLoading) params.append('pointOfLoading', (filters as any).pointOfLoading);
        if ((filters as any).pointOfUnloading) params.append('pointOfUnloading', (filters as any).pointOfUnloading);
        if ((filters as any).ownerOrOperator) params.append('ownerOrOperator', (filters as any).ownerOrOperator);
        if ((filters as any).registration) params.append('registration', (filters as any).registration);
        params.append('page', (filters.page || 1).toString());
        params.append('pageSize', (filters.pageSize || 25).toString());
        params.append('sortBy', filters.sortBy || 'createdAt');
        params.append('sortDir', filters.sortDir || 'desc');

        const rawKey = process.env.MANIFEST_API_KEY as string;
        const authForList = rawKey.startsWith('users API-Key ') ? rawKey : `users API-Key ${rawKey}`;
        const headers = {
            'Authorization': authForList,
            'Content-Type': 'application/json',
        } as HeadersInit;

        const targetUrl = `${API_BASE_URL}/get-manifests?${params.toString()}`;
        await fetchFromApi(targetUrl, res, headers);

    } else if (path === '/get-manifest') {
        // Support reading manifestId from body or query
        const body = (req as any).body;
        let manifestId: string | undefined;
        try {
            manifestId = (typeof body === 'string' ? JSON.parse(body || '{}') : (body || {})).manifestId;
        } catch {}
        if (!manifestId) manifestId = requestUrl.searchParams.get('manifestId') || undefined;

        if (!manifestId) {
            return res.status(400).json({ message: 'A string manifestId is required.' });
        }
        
        const rawKey = process.env.MANIFEST_API_KEY as string;
        const authForDetails = rawKey.startsWith('users API-Key ') ? rawKey : `users API-Key ${rawKey}`;
        const headers = {
            'Authorization': authForDetails,
        } as HeadersInit;
        
        const targetUrl = `${API_BASE_URL}/get-manifest?manifestId=${encodeURIComponent(manifestId)}`;
        await fetchFromApi(targetUrl, res, headers);

    } else {
        res.status(404).json({ message: 'Endpoint not found.' });
    }
}