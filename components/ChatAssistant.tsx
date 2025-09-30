
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ManifestData, Shipment } from '../types';
import { ai } from '../services/geminiService';
import { CloseIcon, SendIcon, SparklesIcon } from './IconComponents';
import type { Chat } from '@google/genai';
import Modal from './Modal';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

// Register minimal light/dark themes
try {
    echarts.registerTheme('acmDark', {
        backgroundColor: 'transparent',
        textStyle: { color: '#cbd5e1' },
        axisPointer: { lineStyle: { color: '#94a3b8' } }
    });
    echarts.registerTheme('acmLight', {
        backgroundColor: 'transparent',
        textStyle: { color: '#0f172a' },
        axisPointer: { lineStyle: { color: '#64748b' } }
    });
} catch {}
import { useReactToPrint } from 'react-to-print';

interface ChatMessage {
    sender: 'user' | 'ai';
    text: string;
    actionsJson?: string; // raw actions JSON suggested by AI
}

interface ChatAssistantProps {
    isOpen: boolean;
    onClose: () => void;
    manifestData: ManifestData | null;
    selectedMawb: Shipment | null;
}

type QuickAction =
    | { type: 'weight_distribution'; label: string }
    | { type: 'anomaly_report'; label: string }
    | { type: 'print_summary'; label: string }
    | { type: 'render_chart'; label: string; spec: ChartSpec };

type ChartSource = 'shipments' | 'hawbs' | 'ulds';
type ChartType = 'bar' | 'line' | 'pie' | 'stacked_bar' | 'scatter' | 'histogram' | 'heatmap' | 'treemap';
type Aggregate = 'sum' | 'count' | 'avg';

interface ChartFilter {
    field: string;
    op: 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'gte' | 'lt' | 'lte';
    value: any;
}

interface ChartSpec {
    source: ChartSource; // which entities to chart
    chartType: ChartType; // bar | line | pie
    xField: string; // field for x/category or numeric (scatter/histogram)
    yField?: string; // numeric field (bar/line/scatter) or value field
    yCategoryField?: string; // for heatmap: y axis category field
    valueField?: string; // for heatmap/treemap custom
    seriesField?: string; // for stacked bar series grouping
    sizeField?: string; // for scatter bubble size (optional)
    parentField?: string; // for treemap parent key
    childField?: string; // for treemap child key
    aggregate?: Aggregate; // sum | count | avg
    title?: string;
    filters?: ChartFilter[];
    topN?: number;
    sort?: 'asc' | 'desc';
    unit?: string; // optional unit label (e.g., kg, lbs, pcs)
    binCount?: number; // for histogram
    stack?: boolean; // for stacked_bar
}

const ChatAssistant: React.FC<ChatAssistantProps> = ({ isOpen, onClose, manifestData, selectedMawb }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [chat, setChat] = useState<Chat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const sessionsRef = useRef<Map<string, { chat: Chat | null; messages: ChatMessage[] }>>(new Map());

    const getSystemInstruction = (): string => {
        return `
            You are an expert air cargo logistics assistant integrated into a manifest viewer dashboard.
            Answer strictly from the provided MANIFEST DATA CONTEXT. If unknown, say you don't know.

            When relevant, append a machine-readable JSON object on the last line with a single key "actions".
            It MUST be valid JSON, no backticks, no extra commentary. The schema is:
            {
              "actions": [
                { "type": "weight_distribution", "label": string },
                { "type": "anomaly_report", "label": string },
                { "type": "print_summary", "label": string },
                { "type": "render_chart", "label": string, "spec": {
                    "source": "shipments"|"hawbs"|"ulds",
                    "chartType": "bar"|"line"|"pie"|"stacked_bar"|"scatter"|"histogram"|"heatmap"|"treemap",
                    "xField": string,
                    "yField": string | null,
                    "yCategoryField": string | null,
                    "valueField": string | null,
                    "seriesField": string | null,
                    "sizeField": string | null,
                    "parentField": string | null,
                    "childField": string | null,
                    "aggregate": "sum"|"count"|"avg",
                    "title": string | null,
                    "filters": [ { "field": string, "op": "eq"|"neq"|"contains"|"in"|"gt"|"gte"|"lt"|"lte", "value": any } ] | null,
                    "topN": number | null,
                    "sort": "asc"|"desc" | null,
                    "unit": string | null,
                    "binCount": number | null,
                    "stack": boolean | null
                }}
              ]
            }

            Only include actions that make sense for the question and data.
        `;
    };

    // Quick actions/modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [modalView, setModalView] = useState<'none' | 'chart' | 'anomaly' | 'print'>('none');

    // Dynamic chart state
    const [chartSpec, setChartSpec] = useState<ChartSpec | null>(null);
    const [dynamicChartData, setDynamicChartData] = useState<{ name: string; value: number }[]>([]);

    const printRef = useRef<HTMLDivElement>(null);
    const triggerPrint = useReactToPrint({ contentRef: printRef });
    const echartsRef = useRef<ReactECharts | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        if (!isOpen) return;
        // Focus input when panel opens or chat becomes available
        const t = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(t);
    }, [isOpen, chat]);

    // Resize charts on window resize and when modal opens
    useEffect(() => {
        const onResize = () => {
            try { echartsRef.current?.getEchartsInstance()?.resize?.(); } catch {}
        };
        window.addEventListener('resize', onResize);
        if (isModalOpen && modalView === 'chart') setTimeout(onResize, 50);
        return () => window.removeEventListener('resize', onResize);
    }, [isModalOpen, modalView]);

    useEffect(() => {
        if (!isOpen || !manifestData) return;

        const systemInstruction = `
            You are an expert air cargo logistics assistant integrated into a manifest viewer dashboard.
            Answer strictly from the provided MANIFEST DATA CONTEXT. If unknown, say you don't know.

            When relevant, append a machine-readable JSON object on the last line with a single key "actions".
            It MUST be valid JSON, no backticks, no extra commentary. The schema is:
            {
              "actions": [
                { "type": "weight_distribution", "label": string },
                { "type": "anomaly_report", "label": string },
                { "type": "print_summary", "label": string },
                { "type": "render_chart", "label": string, "spec": {
                    "source": "shipments"|"hawbs"|"ulds",
                    "chartType": "bar"|"line"|"pie"|"stacked_bar"|"scatter"|"histogram"|"heatmap"|"treemap",
                    "xField": string,
                    "yField": string | null,
                    "yCategoryField": string | null,
                    "valueField": string | null,
                    "seriesField": string | null,
                    "sizeField": string | null,
                    "parentField": string | null,
                    "childField": string | null,
                    "aggregate": "sum"|"count"|"avg",
                    "title": string | null,
                    "filters": [ { "field": string, "op": "eq"|"neq"|"contains"|"in"|"gt"|"gte"|"lt"|"lte", "value": any } ] | null,
                    "topN": number | null,
                    "sort": "asc"|"desc" | null,
                    "unit": string | null,
                    "binCount": number | null,
                    "stack": boolean | null
                }}
              ]
            }

            Only include actions that make sense for the question and data.
        `;

        const key = String(manifestData.manifest_number || manifestData.id);
        const existing = sessionsRef.current.get(key);
        if (existing) {
            setChat(existing.chat);
            setMessages(existing.messages && existing.messages.length ? existing.messages : [{ sender: 'ai', text: `Hello! I'm ready to answer questions about Manifest #${manifestData.manifest_number}. How can I help?` }]);
            return;
        }

        const newChat = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction } });
        setChat(newChat);
        const initial = [{ sender: 'ai', text: `Hello! I'm ready to answer questions about Manifest #${manifestData.manifest_number}. How can I help?` }];
        setMessages(initial);
        sessionsRef.current.set(key, { chat: newChat, messages: initial });
    }, [isOpen, manifestData?.manifest_number]);

    // Persist session messages per manifest
    useEffect(() => {
        if (!manifestData) return;
        const key = String(manifestData.manifest_number || manifestData.id);
        const entry = sessionsRef.current.get(key) || { chat: chat, messages: [] };
        entry.chat = chat;
        entry.messages = messages;
        sessionsRef.current.set(key, entry);
    }, [messages, chat, manifestData]);

    const parseActions = (text: string): { cleanText: string; actions: QuickAction[] } => {
        let actions: QuickAction[] = [];
        let cleanText = text;

        // 1) Try to parse a code-fenced JSON block (```json ... ```), use the LAST block
        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
        const blocks: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            blocks.push(match[1]);
        }
        if (blocks.length > 0) {
            for (let i = blocks.length - 1; i >= 0; i--) {
                try {
                    const maybe = JSON.parse(blocks[i]);
                    if (maybe && Array.isArray(maybe.actions)) {
                        actions = maybe.actions as QuickAction[];
                        cleanText = text.replace(codeBlockRegex, '').trim();
                        try { console.debug('[Actions] parsed from fenced JSON'); } catch {}
                        return { cleanText, actions };
                    }
                } catch {}
            }
        }

        // 2) Fallback: try to parse the last JSON object that contains an "actions" key anywhere in the text
        const anyJsonWithActions = /\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\}[\s\S]*?\}/g; // coarse; iterate
        const candidates: { start: number; end: number; json: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = anyJsonWithActions.exec(text)) !== null) {
            candidates.push({ start: m.index, end: m.index + m[0].length, json: m[0] });
        }
        for (let i = candidates.length - 1; i >= 0; i--) {
            try {
                const maybe = JSON.parse(candidates[i].json);
                if (maybe && Array.isArray(maybe.actions)) {
                    actions = maybe.actions as QuickAction[];
                    cleanText = (text.slice(0, candidates[i].start) + text.slice(candidates[i].end)).trim();
                    try { console.debug('[Actions] parsed from raw JSON block'); } catch {}
                    return { cleanText, actions };
                }
            } catch {}
        }

        // 2c) Brace-balanced scan around the last occurrence of "actions"
        const idx = text.lastIndexOf('"actions"');
        if (idx !== -1) {
            // Walk backward to find the opening brace of the JSON object
            let start = idx;
            while (start >= 0 && text[start] !== '{') start--;
            // If not directly at a brace, continue scanning backward to the previous '{'
            while (start >= 0 && text[start] !== '{') start--;
            if (start >= 0) {
                let depth = 0;
                let end = -1;
                for (let j = start; j < text.length; j++) {
                    const ch = text[j];
                    if (ch === '{') depth++;
                    else if (ch === '}') {
                        depth--;
                        if (depth === 0) { end = j + 1; break; }
                    }
                }
                if (end > start) {
                    const candidate = text.slice(start, end);
                    try {
                        const maybe = JSON.parse(candidate);
                        if (maybe && Array.isArray(maybe.actions)) {
                            actions = maybe.actions as QuickAction[];
                            cleanText = (text.slice(0, start) + text.slice(end)).trim();
                            try { console.debug('[Actions] parsed via brace-balance'); } catch {}
                            return { cleanText, actions };
                        }
                    } catch {}
                }
            }
        }

        // 3) Old behavior: try the last line
        const lines = text.trim().split('\n');
        const last = lines[lines.length - 1];
        try {
            const maybe = JSON.parse(last);
            if (maybe && Array.isArray(maybe.actions)) {
                actions = maybe.actions as QuickAction[];
                cleanText = lines.slice(0, -1).join('\n');
            }
        } catch {}
        if (actions.length) { try { console.debug('[Actions] parsed from last-line JSON'); } catch {} }
        return { cleanText, actions };
    };

    function getValueByPath(obj: any, path: string | undefined): any {
        if (!path) return undefined;
        if (!obj) return undefined;
        const result = !path.includes('.')
            ? (obj as any)[path]
            : path.split('.').reduce((acc: any, key: string) => (acc == null ? undefined : (acc as any)[key]), obj);
        if (result != null && typeof result === 'object') {
            const val = (result as any).value;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                const n = Number(val);
                if (Number.isFinite(n)) return n;
            }
        }
        return result;
    }

    function normalizeFieldPath(field: string | undefined, source: ChartSource): string | undefined {
        if (!field) return field;
        const f = field.toLowerCase();
        const map: Record<string, string> = {
            mawb: 'awb_number', mawb_number: 'awb_number', awb: 'awb_number', mawbno: 'awb_number', 'mawb_no': 'awb_number',
            uld: 'uld_id', uldid: 'uld_id', uld_type: 'uld_id',
            weight: source === 'ulds' ? 'weight.value' : (source === 'hawbs' ? 'actual_weight_kg' : 'weight.value'),
            weight_kg: source === 'ulds' ? 'weight.value' : (source === 'hawbs' ? 'actual_weight_kg' : 'weight.value'),
            actual_weight: 'actual_weight_kg',
            pieces: 'pieces', pcs: 'pieces',
            destination: 'destination', dest: 'destination',
            origin: 'origin',
            customer: 'customer',
            hawb: 'hawb_number', hawb_number: 'hawb_number'
        } as any;
        return map[f] || field;
    }

    function normalizeSpecFields(spec: ChartSpec): ChartSpec {
        const src = spec.source;
        const normalized: ChartSpec = { ...spec } as any;
        // Map known aliases
        normalized.xField = normalizeFieldPath(spec.xField, src) || spec.xField;
        normalized.yField = normalizeFieldPath(spec.yField, src) || spec.yField;
        normalized.yCategoryField = normalizeFieldPath(spec.yCategoryField, src) || spec.yCategoryField;
        normalized.valueField = normalizeFieldPath(spec.valueField, src) || spec.valueField;
        normalized.seriesField = normalizeFieldPath(spec.seriesField, src) || spec.seriesField;
        normalized.sizeField = normalizeFieldPath(spec.sizeField, src) || spec.sizeField;
        normalized.parentField = normalizeFieldPath(spec.parentField, src) || spec.parentField;
        normalized.childField = normalizeFieldPath(spec.childField, src) || spec.childField;
        // Apply sensible defaults when fields are missing
        if (!normalized.xField) {
            normalized.xField = src === 'shipments' ? 'awb_number' : (src === 'ulds' ? 'uld_id' : 'hawb_number');
        }
        if (!normalized.yField) {
            normalized.yField = src === 'hawbs' ? 'actual_weight_kg' : 'weight.value';
        }
        if (normalized.chartType === 'heatmap') {
            if (!normalized.yCategoryField) normalized.yCategoryField = src === 'ulds' ? 'uld_id' : (src === 'hawbs' ? 'destination' : 'uld_id');
            if (!normalized.valueField) normalized.valueField = normalized.yField;
        }
        if (normalized.chartType === 'stacked_bar' && !normalized.seriesField) {
            normalized.seriesField = src === 'ulds' ? 'uld_id' : (src === 'hawbs' ? 'destination' : 'awb_number');
        }
        if (normalized.chartType === 'treemap') {
            if (!normalized.parentField) normalized.parentField = 'awb_number';
            if (!normalized.childField) normalized.childField = 'hawb_number';
            if (!normalized.valueField) normalized.valueField = 'actual_weight_kg';
        }
        try { console.debug('[Spec] normalized fields', { orig: spec, norm: normalized }); } catch {}
        return normalized;
    }

    function getSourceRows(source: ChartSource): any[] {
        if (!manifestData) return [];
        if (source === 'shipments') {
            return (manifestData.shipments || []).map(s => ({
                awb_number: s.awb_number,
                pieces: s.pieces,
                weight_kg: s.weight?.value || 0,
                weight: { value: s.weight?.value || 0 },
                nature_of_goods: s.nature_of_goods,
                destination: manifestData.flight_details?.arrival_airport,
                origin: manifestData.flight_details?.departure_airport
            }));
        }
        if (source === 'ulds') {
            const rows: any[] = [];
            for (const s of manifestData.shipments || []) {
                for (const u of s.uld_contents || []) {
                    rows.push({
                        awb_number: s.awb_number,
                        uld_id: u.uld_id,
                        pieces: u.pieces,
                        weight_kg: u.weight?.value || 0,
                        weight: { value: u.weight?.value || 0 }
                    });
                }
            }
            return rows;
        }
        // hawbs
        const rows: any[] = [];
        for (const s of manifestData.shipments || []) {
            for (const h of s.house_shipments || []) {
                rows.push({
                    awb_number: s.awb_number,
                    hawb_number: h.hawb_number,
                    customer: h.customer,
                    destination: h.destination,
                    origin: h.origin,
                    pieces: h.pieces,
                    weight_kg: h.actual_weight_kg,
                    actual_weight_kg: h.actual_weight_kg
                });
            }
        }
        return rows;
    }

    function applyFilters(rows: any[], filters?: ChartFilter[]): any[] {
        if (!filters || filters.length === 0) return rows;
        return rows.filter(row => {
            return filters.every(f => {
                const v = getValueByPath(row, f.field);
                const val = f.value;
                switch (f.op) {
                    case 'eq': return v === val;
                    case 'neq': return v !== val;
                    case 'contains': return typeof v === 'string' && String(v).toLowerCase().includes(String(val).toLowerCase());
                    case 'in': return Array.isArray(val) && val.includes(v);
                    case 'gt': return Number(v) > Number(val);
                    case 'gte': return Number(v) >= Number(val);
                    case 'lt': return Number(v) < Number(val);
                    case 'lte': return Number(v) <= Number(val);
                    default: return true;
                }
            });
        });
    }

    function generateChartDataFromSpec(spec: ChartSpec): { name: string; value: number }[] {
        const specN = normalizeSpecFields(spec);
        const rowsPre = getSourceRows(specN.source);
        try { console.debug('[Charts] source rows before filter', spec.source, rowsPre.length, rowsPre.slice(0, 3)); } catch {}
        const sourceRows = applyFilters(rowsPre, specN.filters);
        try { console.debug('[Charts] rows after filter', sourceRows.length, 'filters=', specN.filters); } catch {}
        const x = specN.xField; const y = specN.yField || 'value';
        const agg = specN.aggregate || 'sum';
        const groups = new Map<string, number[]>();
        let undefinedName = 0, undefinedValue = 0;
        for (const row of sourceRows) {
            const keyRaw = getValueByPath(row, x!);
            const key = (keyRaw === undefined || keyRaw === null || keyRaw === '') ? '' : String(keyRaw);
            let raw = getValueByPath(row, y);
            // Fallbacks for common patterns (e.g., 'weight' → numeric)
            if (raw === undefined || (typeof raw === 'object' && raw !== null)) {
                if (y && y.endsWith('weight')) {
                    raw = getValueByPath(row, `${y}.value`);
                }
                if (raw === undefined) {
                    raw = getValueByPath(row, 'weight.value') ?? getValueByPath(row, 'weight_kg');
                }
            }
            const yValRaw = raw ?? (y === 'value' ? 1 : 0);
            const yVal = typeof yValRaw === 'number' ? yValRaw : Number(yValRaw) || 0;
            if (!key || key === 'undefined') undefinedName++;
            if (!Number.isFinite(yVal)) undefinedValue++;
            const arr = groups.get(key) || [];
            arr.push(Number.isFinite(yVal) ? yVal : 0);
            groups.set(key, arr);
        }
        let data = Array.from(groups.entries()).map(([name, values]) => {
            let value = 0;
            if (agg === 'count') value = values.length;
            else if (agg === 'avg') value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            else value = values.reduce((a, b) => a + b, 0);
            return { name: name || 'Unknown', value };
        });
        if (specN.sort) {
            data.sort((a, b) => specN.sort === 'asc' ? a.value - b.value : b.value - a.value);
        }
        if (specN.topN && specN.topN > 0) {
            data = data.slice(0, specN.topN);
        }
        // Default cap to reduce clutter if topN not provided
        if (!specN.topN && data.length > 20) {
            data = data.slice(0, 20);
        }
        try {
            console.debug('[Charts] final data points', data.length, data.slice(0, 5));
            if (undefinedName || undefinedValue) console.warn('[Charts] undefined keys/values', { undefinedName, undefinedValue });
        } catch {}
        // Fallback: if more than half the names are undefined, pick a default xField
        if (undefinedName > data.length / 2) {
            const fallbackX = specN.source === 'shipments' ? 'awb_number' : (specN.source === 'ulds' ? 'uld_id' : 'hawb_number');
            if (fallbackX !== x) {
                try { console.warn('[Charts] high undefinedName, retrying with fallback xField', { from: x, to: fallbackX }); } catch {}
                return generateChartDataFromSpec({ ...specN, xField: fallbackX });
            }
        }
        return data;
    }

    // Formatting helpers
    function guessUnit(spec?: ChartSpec | null): string {
        if (!spec) return '';
        if (spec.unit) return spec.unit;
        const f = (spec.yField || '').toLowerCase();
        if (f.includes('weight')) return manifestData?.total_weight?.unit || 'kg';
        if (f.includes('pieces')) return 'pcs';
        return '';
    }

    function toTitle(field?: string): string {
        if (!field) return '';
        const friendly = field.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return friendly;
    }

    function formatWithUnit(value: number, unit?: string): string {
        const n = Number(value) || 0;
        const s = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return unit ? `${s} ${unit}` : s;
    }

    function buildEchartsOption(spec: ChartSpec, data: { name: string; value: number }[]) {
        try { console.debug('[Charts] buildOption spec=', spec, 'dataLen=', data?.length); } catch {}
        const unit = guessUnit(spec);
        const axisLabelColor = '#cbd5e1';
        // 60/40 rule requested: allocate 60% to the plot area vertically by keeping generous top/bottom margins
        const grid = { top: '20%', right: 16, bottom: '20%', left: 64 } as any;
        const common = {
            tooltip: {
                trigger: 'item',
                backgroundColor: '#0f172a',
                borderColor: '#334155',
                textStyle: { color: '#e2e8f0' },
                formatter: (params: any) => `${params.name}<br/>${formatWithUnit(params.value, unit)}`
            },
            grid,
            textStyle: { fontFamily: 'Inter, ui-sans-serif, system-ui' },
            color: ['#22d3ee', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'],
            toolbox: {
                right: 12,
                feature: {
                    saveAsImage: {},
                    restore: {},
                    dataView: { readOnly: true }
                }
            },
            animation: true,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        } as any;

        // Stacked bar
        if (spec.chartType === 'stacked_bar') {
            // Group rows by xField, and within each, by seriesField
            const rows = applyFilters(getSourceRows(spec.source), spec.filters);
            const categories: string[] = [];
            const seriesMap: Map<string, Map<string, number>> = new Map();
            const seriesNames: Set<string> = new Set();
            const seriesField = spec.seriesField || 'series';
            const yField = spec.yField || 'value';
            for (const r of rows) {
                const cat = String(getValueByPath(r, spec.xField));
                const sname = String(getValueByPath(r, seriesField) ?? 'other');
                const vraw = getValueByPath(r, yField) ?? getValueByPath(r, 'weight.value') ?? getValueByPath(r, 'weight_kg') ?? 0;
                const v = Number(vraw) || 0;
                if (!seriesMap.has(sname)) seriesMap.set(sname, new Map());
                const m = seriesMap.get(sname)!;
                m.set(cat, (m.get(cat) || 0) + v);
                seriesNames.add(sname);
                if (!categories.includes(cat)) categories.push(cat);
            }
            const series = Array.from(seriesNames).map(name => ({
                name,
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: categories.map(c => seriesMap.get(name)?.get(c) || 0)
            }));
            return {
                ...common,
                legend: { top: 0, textStyle: { color: axisLabelColor } },
                xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, color: axisLabelColor, hideOverlap: true }, axisLine: { lineStyle: { color: '#334155' } } },
                yAxis: { type: 'value', axisLabel: { color: axisLabelColor, formatter: (v: number) => formatWithUnit(v, unit) }, splitLine: { lineStyle: { color: '#334155' } } },
                dataZoom: categories.length > 12 ? [{ type: 'slider', bottom: 24 }, { type: 'inside' }] : undefined,
                series
            };
        }

        // Scatter
        if (spec.chartType === 'scatter') {
            const rows = applyFilters(getSourceRows(spec.source), spec.filters);
            const x = spec.xField; const y = spec.yField || 'value';
            const sizeField = spec.sizeField;
            const points = rows.map(r => {
                const xv = Number(getValueByPath(r, x) || 0);
                const yv = Number(getValueByPath(r, y) || 0);
                const sv = sizeField ? Number(getValueByPath(r, sizeField) || 0) : 8;
                return { value: [xv, yv, sv], name: String(getValueByPath(r, 'awb_number') || getValueByPath(r, 'hawb_number') || '') };
            });
            return {
                ...common,
                tooltip: { ...common.tooltip, trigger: 'item', formatter: (p: any) => `${p.name || ''}<br/>${x}: ${p.value[0]}<br/>${y}: ${formatWithUnit(p.value[1], unit)}` },
                xAxis: { type: 'value', axisLabel: { color: axisLabelColor }, splitLine: { lineStyle: { color: '#334155' } } },
                yAxis: { type: 'value', axisLabel: { color: axisLabelColor, formatter: (v: number) => formatWithUnit(v, unit) }, splitLine: { lineStyle: { color: '#334155' } } },
                series: [{ type: 'scatter', symbolSize: (val: any) => val[2] || 8, data: points }]
            };
        }

        // Histogram (simple binning on xField numeric)
        if (spec.chartType === 'histogram') {
            const rows = applyFilters(getSourceRows(spec.source), spec.filters);
            const x = spec.xField;
            const values = rows.map(r => Number(getValueByPath(r, x) || 0)).filter(v => Number.isFinite(v));
            const bins = Math.max(5, Math.min(spec.binCount || 12, 50));
            const min = Math.min(...values, 0); const max = Math.max(...values, 1);
            const step = (max - min) / bins || 1;
            const counts = new Array(bins).fill(0);
            for (const v of values) {
                let idx = Math.floor((v - min) / step); if (idx >= bins) idx = bins - 1; if (idx < 0) idx = 0; counts[idx]++;
            }
            const labels = counts.map((_, i) => `${(min + i*step).toFixed(0)}–${(min + (i+1)*step).toFixed(0)}`);
            return {
                ...common,
                xAxis: { type: 'category', data: labels, axisLabel: { rotate: 45, color: axisLabelColor, hideOverlap: true }, axisLine: { lineStyle: { color: '#334155' } } },
                yAxis: { type: 'value', axisLabel: { color: axisLabelColor }, splitLine: { lineStyle: { color: '#334155' } } },
                series: [{ type: 'bar', data: counts }]
            };
        }

        // Heatmap (xCategory by spec.xField, yCategory by yCategoryField, value from yField/valueField)
        if (spec.chartType === 'heatmap') {
            const specN = normalizeSpecFields(spec);
            const rows = applyFilters(getSourceRows(specN.source), specN.filters);
            const xCatSet = new Set<string>(); const yCatSet = new Set<string>();
            const cellMap: Map<string, number> = new Map();
            const xField = specN.xField!; const yCatField = specN.yCategoryField || 'uld_id';
            const vField = specN.valueField || specN.yField || 'weight.value';
            for (const r of rows) {
                const x = String(getValueByPath(r, xField));
                const y = String(getValueByPath(r, yCatField));
                const v = Number(getValueByPath(r, vField) ?? getValueByPath(r, 'weight.value') ?? getValueByPath(r, 'weight_kg') ?? 0) || 0;
                xCatSet.add(x); yCatSet.add(y);
                const key = `${x}||${y}`; cellMap.set(key, (cellMap.get(key) || 0) + v);
            }
            const xCats = Array.from(xCatSet); const yCats = Array.from(yCatSet);
            const seriesData = [] as any[];
            for (let i = 0; i < xCats.length; i++) {
                for (let j = 0; j < yCats.length; j++) {
                    const key = `${xCats[i]}||${yCats[j]}`;
                    seriesData.push([i, j, cellMap.get(key) || 0]);
                }
            }
            const maxVal = seriesData.reduce((m, d) => Math.max(m, d[2]), 0);
            return {
                ...common,
                tooltip: { ...common.tooltip, formatter: (p: any) => `${xField}: ${xCats[p.value[0]]}<br/>${yCatField}: ${yCats[p.value[1]]}<br/>${formatWithUnit(p.value[2], unit)}` },
                xAxis: { type: 'category', data: xCats, axisLabel: { color: axisLabelColor, rotate: 45, hideOverlap: true } },
                yAxis: { type: 'category', data: yCats, axisLabel: { color: axisLabelColor } },
                visualMap: { min: 0, max: maxVal, calculable: true, orient: 'vertical', right: 10, top: 'middle', textStyle: { color: axisLabelColor } },
                series: [{ type: 'heatmap', data: seriesData }]
            };
        }

        // Treemap (default: group hawbs by awb_number)
        if (spec.chartType === 'treemap') {
            const rows = applyFilters(getSourceRows('hawbs'), spec.filters);
            const map = new Map<string, { name: string; value: number; children: any[] }>();
            let totalRows = 0, dropped = 0;
            for (const r of rows) {
                totalRows++;
                const parent = String(getValueByPath(r, spec.parentField || 'awb_number') ?? '');
                const child = String(getValueByPath(r, spec.childField || 'hawb_number') ?? '');
                const raw = getValueByPath(r, spec.valueField || 'actual_weight_kg') ?? 0;
                const v = Number(raw);
                if (!parent || !child || !Number.isFinite(v)) { dropped++; continue; }
                if (!map.has(parent)) map.set(parent, { name: parent, value: 0, children: [] });
                const node = map.get(parent)!;
                node.children.push({ name: child, value: Math.max(0, v) });
                node.value += Math.max(0, v);
            }
            // remove empty parents and sort by value desc
            const dataTree = Array.from(map.values()).filter(n => n.value > 0 && n.children.length > 0).sort((a,b)=>b.value-a.value);
            try {
                console.debug('[Treemap] rows:', totalRows, 'dropped:', dropped, 'parents:', dataTree.length);
                console.table(dataTree.slice(0,5).map(n=>({ parent:n.name, children:n.children.length, value:n.value })));
            } catch {}
            return {
                ...common,
                series: [{ type: 'treemap', roam: true, leafDepth: 1, breadcrumb: { show: true }, label: { show: true }, data: dataTree }]
            };
        }

        if (spec.chartType === 'pie') {
            return {
                ...common,
                legend: { bottom: 0, textStyle: { color: axisLabelColor } },
                series: [{
                    type: 'pie',
                    radius: ['30%', '70%'],
                    avoidLabelOverlap: true,
                    label: { show: false, color: axisLabelColor },
                    labelLine: { show: false },
                    emphasis: { scale: true, itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' } },
                    data
                }]
            };
        }

        // bar or line
        return {
            ...common,
            xAxis: {
                type: 'category',
                data: data.map(d => d.name),
                axisLabel: { rotate: 45, color: axisLabelColor, interval: 0, hideOverlap: true },
                axisLine: { lineStyle: { color: '#334155' } }
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    color: axisLabelColor,
                    formatter: (v: number) => formatWithUnit(v, unit)
                },
                splitLine: { lineStyle: { color: '#334155' } }
            },
            dataZoom: data.length > 12 ? [{ type: 'slider', bottom: 24 }, { type: 'inside' }] : undefined,
            series: [{
                type: spec.chartType === 'line' ? 'line' : 'bar',
                data: data.map(d => d.value),
                smooth: spec.chartType === 'line',
                emphasis: { focus: 'series' }
            }]
        };
    }

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading || !manifestData) return;

        const userMessage: ChatMessage = { sender: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        const currentInput = input;
        setInput('');
        setIsLoading(true);

        const mawbContext = selectedMawb ? `Selected MAWB: ${selectedMawb.awb_number}` : 'No specific MAWB selected';
        const prompt = `
            QUESTION: "${currentInput}"

            CONTEXT NOTE: ${mawbContext}

            MANIFEST DATA CONTEXT:
            ${JSON.stringify({ manifest: manifestData }, null, 2)}
        `;

        try {
            // Ensure we have a chat instance; create on-demand if missing
            let currentChat = chat;
            if (!currentChat) {
                currentChat = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction: getSystemInstruction() } });
                setChat(currentChat);
            }
            const stream = await currentChat.sendMessageStream({ message: prompt });
            let aiAccumulated = '';
            setMessages(prev => [...prev, { sender: 'ai', text: '' }]);

            for await (const chunk of stream) {
                aiAccumulated += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    // Hide any trailing actions JSON from the visible text while streaming
                    const { cleanText } = parseActions(aiAccumulated);
                    newMessages[newMessages.length - 1] = { ...newMessages[newMessages.length - 1], text: cleanText };
                    return newMessages;
                });
            }

            // After stream completes, attempt to parse actions from the RAW text (not the cleaned visible text)
            setMessages(prev => {
                const { cleanText, actions } = parseActions(aiAccumulated);
                // Debug: log detected actions
                if (actions && actions.length) {
                    console.debug('AI suggested actions:', actions);
                } else {
                    console.debug('No actions detected in AI response.');
                }
                const updated = [
                    ...prev.slice(0, -1),
                    { sender: 'ai', text: cleanText, actionsJson: actions.length ? JSON.stringify({ actions }) : undefined }
                ];

                // Do not auto-execute actions; user must click buttons explicitly.
                return updated;
            });
        } catch (error) {
            console.error("Error sending message to AI:", error);
            const errorMessage: ChatMessage = { sender: 'ai', text: "Sorry, an error occurred while generating the response. Please try again." };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const formatMessage = (text: string) => {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="bg-slate-900/80 ring-1 ring-slate-600 px-1 py-0.5 rounded text-sm">$1</code>')
            .replace(/\n/g, '<br/>');
    };

    const latestActions: QuickAction[] = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.sender === 'ai' && m.actionsJson) {
                try {
                    const parsed = JSON.parse(m.actionsJson);
                    if (Array.isArray(parsed.actions)) {
                        return parsed.actions as QuickAction[];
                    }
                } catch {}
            }
        }
        return [];
    }, [messages]);

    // Auto-execute actions when the AI suggests them (especially render_chart)
    const lastActionsHashRef = useRef<string>('');
    useEffect(() => {
        if (!isOpen || !manifestData || !latestActions.length) return;
        const hash = JSON.stringify(latestActions);
        if (hash === lastActionsHashRef.current) return;
        lastActionsHashRef.current = hash;

        // Prefer executing a render_chart action automatically
        const preferred = latestActions.find(a => a.type === 'render_chart');
        if (preferred) {
            openAction(preferred);
            return;
        }
        // If only a single action is present, auto-execute it as well
        if (latestActions.length === 1) {
            openAction(latestActions[0]);
        }
    }, [latestActions, isOpen, manifestData]);

    // Derived data for views
    const weightChartData = useMemo(() => {
        if (!manifestData) return [] as { awb: string; weight: number }[];
        return (manifestData.shipments || []).map(s => ({ awb: s.awb_number, weight: s.weight?.value || 0 }));
    }, [manifestData]);

    const anomalies = useMemo(() => {
        if (!manifestData) return [] as { awb: string; issue: string; details?: string }[];
        const rows: { awb: string; issue: string; details?: string }[] = [];
        for (const s of manifestData.shipments || []) {
            const totalHouseWeight = (s.house_shipments || []).reduce((sum, h) => sum + (h.actual_weight_kg || 0), 0);
            const delta = Math.abs((s.weight?.value || 0) - totalHouseWeight);
            if (delta > Math.max(50, (s.weight?.value || 0) * 0.05)) {
                rows.push({ awb: s.awb_number, issue: 'Weight mismatch', details: `MAWB ${s.weight?.value}kg vs HAWBs ${totalHouseWeight}kg (Δ ${delta}kg)` });
            }
            if (!s.uld_contents || s.uld_contents.length === 0) {
                rows.push({ awb: s.awb_number, issue: 'No ULD association' });
            }
        }
        return rows;
    }, [manifestData]);

    // AI-driven suggested actions
    const [aiSuggestedActions, setAiSuggestedActions] = useState<QuickAction[]>([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const suggestHashRef = useRef<string>('');

    const fetchAiSuggestions = useCallback(async () => {
        if (!isOpen || !manifestData) { setAiSuggestedActions([]); return; }
        const hash = JSON.stringify({ id: manifestData.id, selected: selectedMawb?.awb_number });
        if (hash === suggestHashRef.current && aiSuggestedActions.length) return; // avoid duplicate calls
        suggestHashRef.current = hash;
        setIsSuggesting(true);
        try {
            const unit = manifestData.total_weight?.unit || 'kg';
            const systemInstruction = `
                You are a logistics analytics copilot embedded into a dashboard.
                Propose up to 6 high-value quick actions the user can execute now.
                Output ONLY JSON with the following schema, no prose, no code fences:
                { "actions": [ { "type": "render_chart"|"anomaly_report"|"print_summary"|"weight_distribution", "label": string, "spec"?: {
                    "source": "shipments"|"hawbs"|"ulds",
                    "chartType": "bar"|"line"|"pie",
                    "xField": string,
                    "yField": string | null,
                    "aggregate": "sum"|"count"|"avg",
                    "title": string | null,
                    "filters": [ { "field": string, "op": "eq"|"neq"|"contains"|"in"|"gt"|"gte"|"lt"|"lte", "value": any } ] | null,
                    "topN": number | null,
                    "sort": "asc"|"desc" | null,
                    "unit": string | null
                } } ] }
                Guidance:
                - Prefer concise, insightful visuals (topN 10-20) and include unit: "${unit}" for weight charts.
                - If a MAWB is selected (${selectedMawb?.awb_number || 'none'}), tailor at least two actions to it.
                - Avoid duplicate actions; keep labels ≤ 48 chars.
            `;

            // Build a compact context to avoid oversized payloads
            const shipments = (manifestData.shipments || []).map(s => ({
                awb_number: s.awb_number,
                pieces: s.pieces,
                weight: (s.weight?.value || 0)
            }));
            shipments.sort((a, b) => b.weight - a.weight);
            const topMawbs = shipments.slice(0, 30);

            const sel = selectedMawb ? {
                awb_number: selectedMawb.awb_number,
                topUlds: (selectedMawb.uld_contents || []).map(u => ({ uld_id: u.uld_id || 'UNKNOWN', pieces: u.pieces, weight: u.weight?.value || 0 })).sort((a,b)=>b.weight-a.weight).slice(0, 20),
                topHawbs: (selectedMawb.house_shipments || []).map(h => ({ hawb_number: h.hawb_number, pieces: h.pieces, weight: h.actual_weight_kg || 0 })).sort((a,b)=>b.weight-a.weight).slice(0, 20)
            } : null;

            const compact = {
                manifest_number: manifestData.manifest_number,
                flight: manifestData.flight_details?.flight_number,
                route: `${manifestData.flight_details?.departure_airport} → ${manifestData.flight_details?.arrival_airport}`,
                totals: { pieces: manifestData.total_pieces, weight: manifestData.total_weight?.value || 0, unit },
                topMawbs,
                selected: sel
            };

            const prompt = `SUGGEST_ACTIONS with COMPACT_CONTEXT:\n${JSON.stringify(compact)}`;

            async function tryOnce(model: string): Promise<QuickAction[] | null> {
                const chat = ai.chats.create({ model, config: { systemInstruction, responseMimeType: 'application/json' } });
                const stream = await chat.sendMessageStream({ message: prompt });
                let raw = '';
                for await (const chunk of stream) { raw += chunk.text; }
                const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
                let parsed: any = null;
                try { parsed = JSON.parse(cleaned); } catch {}
                const actions: QuickAction[] = parsed && Array.isArray(parsed.actions) ? parsed.actions : [];
                return actions.length ? actions : null;
            }

            const models = ['gemini-2.5-flash'];
            let got: QuickAction[] | null = null;
            for (const model of models) {
                for (let attempt = 0; attempt < 3 && !got; attempt++) {
                    try {
                        got = await tryOnce(model);
                        if (!got) {
                            // parsed but empty, treat as failure to trigger fallback
                            throw new Error('Empty suggestions');
                        }
                    } catch (err) {
                        const delay = 500 * Math.pow(2, attempt);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
                if (got) break;
            }
            setAiSuggestedActions(got || []);
        } catch (e) {
            console.error('Error fetching AI suggestions', e);
            setAiSuggestedActions([]);
        } finally {
            setIsSuggesting(false);
        }
    }, [isOpen, manifestData, selectedMawb, aiSuggestedActions.length]);

    // Suggestions are now on-demand; no auto-fetch on open.

    useEffect(() => {
        if (!isOpen || !manifestData || !latestActions.length) return;
        const hash = JSON.stringify(latestActions);
        if (hash === lastActionsHashRef.current) return;
        lastActionsHashRef.current = hash;

        // Prefer executing a render_chart action automatically
        const preferred = latestActions.find(a => a.type === 'render_chart');
        if (preferred) {
            openAction(preferred);
            return;
        }
        // If only a single action is present, auto-execute it as well
        if (latestActions.length === 1) {
            openAction(latestActions[0]);
        }
    }, [latestActions, isOpen, manifestData]);

    const openAction = (action: QuickAction) => {
        if (!manifestData) return;
        try { console.debug('[Actions] openAction', action); } catch {}
        if (action.type === 'weight_distribution') {
            setModalTitle('Weight Distribution by MAWB');
            setModalView('chart');
            setChartSpec(null);
            setIsModalOpen(true);
        } else if (action.type === 'anomaly_report') {
            setModalTitle('Anomaly Report');
            setModalView('anomaly');
            setIsModalOpen(true);
        } else if (action.type === 'print_summary') {
            setModalTitle('Printable Summary');
            setModalView('print');
            setIsModalOpen(true);
            setTimeout(() => triggerPrint?.(), 100); // auto-open print dialog
        } else if (action.type === 'render_chart') {
            try {
                const spec = action.spec as ChartSpec;
                const data = generateChartDataFromSpec(spec);
                setChartSpec(spec);
                setDynamicChartData(data);
                setModalTitle(spec.title || action.label || 'Chart');
                setModalView('chart');
                setIsModalOpen(true);
                if (!data || data.length === 0) {
                    console.warn('[Charts] Empty dataset for spec', spec);
                }
            } catch (e) {
                console.error('Error generating dynamic chart:', e);
            }
        }
    };

    if (!isOpen) return null;

    const isChatDisabled = !manifestData;

    return (
        <>
        <div className={`fixed bottom-16 right-4 w-full max-w-md h-2/3 max-h-[600px] rounded-lg border shadow-2xl flex flex-col z-50 ${document?.body?.dataset?.theme==='light' ? 'bg-white border-slate-200' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex items-center justify-between p-3 border-b border-slate-700 flex-shrink-0">
                <div className="flex items-center space-x-2">
                    <SparklesIcon className="w-6 h-6 text-cyan-400" />
                    <h2 className={`text-lg font-semibold ${document?.body?.dataset?.theme==='light' ? 'text-slate-900' : 'text-white'}`}>AI Assistant</h2>
                </div>
                <button onClick={onClose} className={`${document?.body?.dataset?.theme==='light' ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'} transition-colors`}>
                    <CloseIcon className="w-6 h-6" />
                </button>
            </div>
            <div className="flex-grow p-4 overflow-y-auto space-y-4">
                <div className="flex flex-wrap gap-2">
                    <button onClick={fetchAiSuggestions} disabled={isSuggesting || !manifestData} className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${document?.body?.dataset?.theme==='light' ? 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200' : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'}`}>Suggest actions</button>
                    {!isSuggesting && aiSuggestedActions.map((a, i) => (
                        <button key={`ai-suggest-${i}`} onClick={() => openAction(a)} className={`text-xs px-3 py-1 rounded border ${document?.body?.dataset?.theme==='light' ? 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200' : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'}`}>
                            {a.label}
                        </button>
                    ))}
                </div>
                {messages.map((msg, index) => {
                    const actions: QuickAction[] = (() => {
                        if (msg.sender !== 'ai' || !msg.actionsJson) return [];
                        try { const parsed = JSON.parse(msg.actionsJson); return parsed.actions || []; } catch { return []; }
                    })();
                    return (
                        <div key={index} className={`flex flex-col gap-2 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                                {msg.sender === 'ai' && <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0"><SparklesIcon className="w-5 h-5 text-slate-900"/></div>}
                                <div className={`max-w-xs md:max-w-sm rounded-lg px-4 py-2 ${msg.sender === 'user' ? 'bg-cyan-600 text-white' : (document?.body?.dataset?.theme==='light' ? 'bg-slate-100 text-slate-800' : 'bg-slate-700')}`}>
                                   <p className="text-sm" dangerouslySetInnerHTML={{ __html: formatMessage(msg.text) }} />
                                </div>
                            </div>
                            {actions.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {actions.map((a, i) => (
                                        <button key={i} onClick={() => openAction(a)} className={`text-xs px-3 py-1 rounded ${document?.body?.dataset?.theme==='light' ? 'bg-cyan-600 text-white hover:bg-cyan-500' : 'bg-cyan-600 text-white hover:bg-cyan-500'}`}>
                                            {a.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
                {isLoading && messages[messages.length-1]?.sender === 'user' && (
                     <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0"><SparklesIcon className="w-5 h-5 text-slate-900"/></div>
                        <div className={`max-w-xs md:max-w-sm rounded-lg px-4 py-2 flex items-center ${document?.body?.dataset?.theme==='light' ? 'bg-slate-100' : 'bg-slate-700'}`}>
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-75"></div>
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150 mx-1"></div>
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-300"></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-slate-700 flex-shrink-0">
                <form onSubmit={handleSend} className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isChatDisabled ? "Select a manifest to start" : "Ask about the manifest..."}
                        className={`w-full border rounded-md py-2 px-4 text-sm focus:ring-cyan-500 focus:border-cyan-500 ${document?.body?.dataset?.theme==='light' ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-600'}`}
                        ref={inputRef}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend(e);
                            }
                        }}
                    />
                    <button type="submit" disabled={isLoading || !input.trim() || isChatDisabled} className="bg-cyan-500 text-slate-900 p-2 rounded-md hover:bg-cyan-400 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors">
                        <SendIcon className="w-5 h-5"/>
                    </button>
                </form>
            </div>
        </div>

        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalTitle} size={modalView === 'chart' ? 'fullscreen' : (modalView === 'print' ? 'xl' : 'lg')}>
            {modalView === 'chart' && (
                <div className="h-[calc(100vh-180px)]">
                    {chartSpec && dynamicChartData.length === 0 ? (
                        <div className="h-full w-full flex items-center justify-center text-sm text-slate-400">
                            No data to display for this request. Try different filters or a different metric.
                        </div>
                    ) : (
                        <ReactECharts
                            style={{ height: '100%', width: '100%' }}
                            option={buildEchartsOption(
                                chartSpec || { source: 'shipments', chartType: 'bar', xField: 'awb', yField: 'weight', aggregate: 'sum' } as any,
                                chartSpec ? dynamicChartData : weightChartData.map(d => ({ name: d.awb, value: d.weight }))
                            )}
                            echarts={echarts}
                            theme={document?.body?.dataset?.theme==='light' ? 'acmLight' : 'acmDark'}
                            opts={{ renderer: 'canvas' }}
                            onChartReady={(inst) => { (echartsRef.current as any) = { getEchartsInstance: () => inst }; }}
                            onEvents={{
                                rendered: () => { try { console.debug('[Charts] rendered'); } catch {} },
                                finished: () => { try { console.debug('[Charts] finished'); } catch {} }
                            }}
                            notMerge={true}
                        />
                    )}
                </div>
            )}

            {modalView === 'anomaly' && (
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-slate-400 border-b border-slate-700">
                            <tr>
                                <th className="text-left p-2">MAWB</th>
                                <th className="text-left p-2">Issue</th>
                                <th className="text-left p-2">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {anomalies.length === 0 ? (
                                <tr><td colSpan={3} className="p-4 text-center text-slate-500">No anomalies detected.</td></tr>
                            ) : anomalies.map((row, i) => (
                                <tr key={i} className="border-b border-slate-800">
                                    <td className="p-2 font-mono">{row.awb}</td>
                                    <td className="p-2">{row.issue}</td>
                                    <td className="p-2 text-slate-400">{row.details}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modalView === 'print' && (
                <div ref={printRef} className="space-y-4">
                    <h3 className="text-xl font-semibold text-white">Manifest #{manifestData?.manifest_number} — Flight {manifestData?.flight_details?.flight_number}</h3>
                    <div className="text-slate-300">
                        <p>Route: {manifestData?.flight_details?.departure_airport} → {manifestData?.flight_details?.arrival_airport}</p>
                        <p>Total Pieces: {manifestData?.total_pieces?.toLocaleString?.()}</p>
                        <p>Total Weight: {manifestData?.total_weight?.value?.toLocaleString?.()} kg</p>
                    </div>
                    <div>
                        <h4 className="font-semibold text-white mb-2">MAWBs</h4>
                        <table className="w-full text-sm">
                            <thead className="text-slate-400 border-b border-slate-700">
                                <tr>
                                    <th className="text-left p-2">MAWB</th>
                                    <th className="text-left p-2">Pieces</th>
                                    <th className="text-left p-2">Weight (kg)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(manifestData?.shipments || []).map((s) => (
                                    <tr key={s.awb_number} className="border-b border-slate-800">
                                        <td className="p-2 font-mono">{s.awb_number}</td>
                                        <td className="p-2">{s.pieces}</td>
                                        <td className="p-2">{s.weight?.value?.toLocaleString?.()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {modalView === 'chart' && (
                <div className="px-4 pb-4 flex justify-end gap-2">
                    <button
                        className={`text-xs px-3 py-1 rounded border ${document?.body?.dataset?.theme==='light' ? 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200' : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'}`}
                        onClick={() => {
                            try {
                                const url = echartsRef.current?.getEchartsInstance()?.getDataURL({ pixelRatio: 2, backgroundColor: document?.body?.dataset?.theme==='light' ? '#ffffff' : '#0f172a' });
                                if (!url) return;
                                const a = document.createElement('a');
                                a.href = url; a.download = 'chart.png'; a.click();
                            } catch (e) { console.error('Export failed', e); }
                        }}
                    >Download PNG</button>
                </div>
            )}
        </Modal>
        </>
    );
};

export default ChatAssistant;