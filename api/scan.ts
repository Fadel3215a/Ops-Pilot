import { analyzeSecurityHeaders } from '../src/scanner/headers';
import type { ScanResult } from '../src/scanner/types';
import type { LossAnalysis } from '../src/engine/types';
import { calculateLoss } from '../src/engine';
import { DEFAULT_BASELINE, type StoreBaseline } from '../src/engine/types';

export const config = { maxDuration: 60 };

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const PSI_FETCH_TIMEOUT_MS = 30_000;
export const HEADER_FETCH_TIMEOUT_MS = 15_000;
export const SCAN_RESPONSE_CAP_MS = 35_000;

const PSI_STRATEGY = 'desktop';

interface ApiScanBody {
  url?: unknown;
  baseline?: unknown;
}

export interface ApiScanResponse {
  ok: boolean;
  url?: string;
  baseline?: StoreBaseline;
  scan?: ScanResult;
  loss?: LossAnalysis;
  error?: string;
}

interface ScanRequest {
  method?: string;
  url?: string;
  body?: unknown;
  on?: {
    (event: 'data', handler: (chunk: Buffer) => void): void;
    (event: 'end', handler: () => void): void;
    (event: 'error', handler: (err: Error) => void): void;
  };
}

interface ScanResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface PsiAudit {
  numericValue?: number;
  details?: { items?: Array<Record<string, unknown>> };
}

interface PsiApiResult {
  lighthouseResult?: { audits?: Record<string, PsiAudit> };
  error?: { code?: number; message?: string };
}

type PsiOutcome = { ok: true; data: PsiApiResult } | { ok: false; error: string };

function sendJson(res: ScanResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: ScanRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on?.('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on?.('end', () => {
      if (raw.trim() === '') {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on?.('error', reject);
  });
}

function normalizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (value === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (parsed.hostname === '') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function queryParam(req: ScanRequest, name: string): unknown {
  if (req.url === undefined) return undefined;
  try {
    return new URL(req.url, 'http://opspilot.local').searchParams.get(name);
  } catch {
    return undefined;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeBaseline(input: unknown): StoreBaseline {
  if (input === null || typeof input !== 'object') return { ...DEFAULT_BASELINE };
  const base = input as Partial<StoreBaseline>;
  const traffic = isFiniteNumber(base.monthlyTraffic)
    ? Math.min(Math.max(Math.round(base.monthlyTraffic), 1), 10_000_000)
    : DEFAULT_BASELINE.monthlyTraffic;
  const aov = isFiniteNumber(base.aov)
    ? Math.min(Math.max(base.aov, 1), 100_000)
    : DEFAULT_BASELINE.aov;
  const cr = isFiniteNumber(base.baselineConversionRate)
    ? Math.min(Math.max(base.baselineConversionRate, 0.0001), 0.5)
    : DEFAULT_BASELINE.baselineConversionRate;
  return { monthlyTraffic: traffic, aov, baselineConversionRate: cr };
}

function emptyScanResult(url: string): ScanResult {
  return {
    url,
    timestamp: new Date().toISOString(),
    performance: { ttfb: 0, lcp: 0, totalBlockingTime: 0, totalPayloadBytes: 0 },
    dom: {
      totalNodes: 0,
      maxDepth: 0,
      scriptTagCount: 0,
      inlineScriptCount: 0,
      externalScriptCount: 0,
    },
    thirdParty: { scriptCount: 0, payloadBytes: 0, domains: [] },
    securityHeaders: { hsts: false, csp: false, xFrameOptions: null, xContentTypeOptions: false, score: 0 },
    payloadBytesByType: { javascript: 0, css: 0, image: 0, font: 0 },
    error: null,
  };
}

async function fetchPsi(url: string): Promise<PsiOutcome> {
  const strategy = process.env.PAGESPEED_STRATEGY === 'mobile' ? 'mobile' : PSI_STRATEGY;
  const params = new URLSearchParams({ url, category: 'PERFORMANCE', strategy });
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key !== undefined && key !== '') params.set('key', key);
  const endpoint = `${PSI_ENDPOINT}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PSI_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `PageSpeed API returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as PsiApiResult;
    if (data.error !== undefined) {
      const code = data.error.code ?? 'unknown';
      const message = data.error.message ?? 'unknown error';
      return { ok: false, error: `PageSpeed API error ${code}: ${message}` };
    }
    if (data.lighthouseResult === undefined) {
      return { ok: false, error: 'PageSpeed API returned no Lighthouse result' };
    }
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'PageSpeed fetch timed out'
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, error: `PageSpeed fetch failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

function readAuditNumeric(audits: Record<string, PsiAudit> | undefined, id: string): number | null {
  const value = audits?.[id]?.numericValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function readDomStatistic(audits: Record<string, PsiAudit> | undefined, pattern: RegExp): number | null {
  const items = audits?.['dom-size']?.details?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const statistic = item.statistic;
    const value = item.value;
    if (typeof statistic === 'string' && pattern.test(statistic) && typeof value === 'number') {
      return Math.round(value);
    }
  }
  return null;
}

function collectNetworkItems(audits: Record<string, PsiAudit> | undefined): Array<Record<string, unknown>> {
  const items = audits?.['network-requests']?.details?.items;
  if (!Array.isArray(items)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item !== null && typeof item === 'object') out.push(item);
  }
  return out;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function computePayloadBreakdown(items: Array<Record<string, unknown>>): ScanResult['payloadBytesByType'] {
  const breakdown: ScanResult['payloadBytesByType'] = { javascript: 0, css: 0, image: 0, font: 0 };
  for (const item of items) {
    const type = typeof item.resourceType === 'string' ? item.resourceType.toLowerCase() : '';
    const size = asNumber(item.resourceSize);
    if (type === 'script') breakdown.javascript += size;
    else if (type === 'stylesheet') breakdown.css += size;
    else if (type === 'font') breakdown.font += size;
    else if (type === 'image') breakdown.image += size;
  }
  return breakdown;
}

function computeThirdParty(
  audits: Record<string, PsiAudit> | undefined,
  hostname: string,
): ScanResult['thirdParty'] {
  const items = audits?.['third-party-summary']?.details?.items;
  const base: ScanResult['thirdParty'] = { scriptCount: 0, payloadBytes: 0, domains: [] };
  if (!Array.isArray(items)) return base;

  const domains: string[] = [];
  let payloadBytes = 0;
  for (const item of items) {
    const entity = item.entity as { name?: unknown } | undefined;
    const name = typeof entity?.name === 'string' ? entity.name : '';
    if (name === '' || name.toLowerCase() === hostname.toLowerCase()) continue;
    domains.push(name);
    payloadBytes += asNumber(item.transferSize);
  }
  const unique = [...new Set(domains)];
  return { scriptCount: unique.length, payloadBytes: Math.round(payloadBytes), domains: unique };
}

function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    out[name.toLowerCase()] = value;
  }
  return out;
}

interface HeaderFetchResult {
  headers: Record<string, string>;
  error: string | null;
}

async function fetchSecurityHeaders(url: string): Promise<HeaderFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEADER_FETCH_TIMEOUT_MS);
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (head.ok) {
      head.body?.cancel?.();
      return { headers: collectHeaders(head.headers), error: null };
    }
    const get = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    if (get.ok) {
      get.body?.cancel?.();
      return { headers: collectHeaders(get.headers), error: null };
    }
    get.body?.cancel?.();
    return {
      headers: {},
      error: `Security header fetch failed (HEAD ${head.status}, GET ${get.status})`,
    };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Security header fetch timed out'
      : err instanceof Error
        ? err.message
        : String(err);
    return { headers: {}, error: `Security header fetch failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function runLiveScan(url: string): Promise<ScanResult> {
  const scan = emptyScanResult(url);
  const parsed = new URL(url);

  const headerResult = await fetchSecurityHeaders(url);
  const errors: string[] = [];
  if (headerResult.error !== null) errors.push(headerResult.error);
  scan.securityHeaders = analyzeSecurityHeaders(headerResult.headers);

  if (process.env.PAGESPEED_MOCK === '1') {
    scan.performance = { ttfb: 220, lcp: 1460, totalBlockingTime: 180, totalPayloadBytes: 2_940_000 };
    scan.dom = { totalNodes: 388, maxDepth: 16, scriptTagCount: 5, inlineScriptCount: 1, externalScriptCount: 4 };
    scan.thirdParty = {
      scriptCount: 2,
      payloadBytes: 96_000,
      domains: ['cdn.example.net', 'analytics.example.net'],
    };
    scan.payloadBytesByType = { javascript: 1_620_000, css: 260_000, image: 890_000, font: 150_000 };
    scan.error = errors.join('; ') || null;
    return scan;
  }

  const psi = await fetchPsi(url);
  if (!psi.ok) {
    errors.unshift(psi.error);
    scan.error = errors.join('; ') || null;
    return scan;
  }

  const audits = psi.data.lighthouseResult?.audits ?? {};
  const networkItems = collectNetworkItems(audits);

  scan.performance.ttfb =
    readAuditNumeric(audits, 'server-response-time') ??
    readAuditNumeric(audits, 'time-to-first-byte') ??
    0;
  scan.performance.lcp = readAuditNumeric(audits, 'largest-contentful-paint') ?? 0;
  scan.performance.totalBlockingTime = readAuditNumeric(audits, 'total-blocking-time') ?? 0;
  scan.performance.totalPayloadBytes =
    readAuditNumeric(audits, 'total-byte-weight') ??
    Math.round(networkItems.reduce((sum, item) => sum + asNumber(item.resourceSize), 0));

  scan.payloadBytesByType = computePayloadBreakdown(networkItems);
  scan.thirdParty = computeThirdParty(audits, parsed.hostname);

  scan.dom.totalNodes = readAuditNumeric(audits, 'dom-size') ?? 0;
  scan.dom.maxDepth = readDomStatistic(audits, /max\s+dom\s+depth/i) ?? 0;
  scan.dom.externalScriptCount = networkItems.filter(
    (item) => typeof item.resourceType === 'string' && item.resourceType.toLowerCase() === 'script',
  ).length;
  scan.dom.scriptTagCount = scan.dom.externalScriptCount;
  scan.dom.inlineScriptCount = 0;

  scan.error = errors.join('; ') || null;
  return scan;
}

export default async function handleScan(req: ScanRequest, res: ScanResponse): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  let body: unknown = undefined;
  if (method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }
  }

  const input = method === 'POST' ? (body as ApiScanBody | undefined)?.url : queryParam(req, 'url');
  const url = normalizeUrl(input);
  if (url === null) {
    sendJson(res, 400, { ok: false, error: 'A valid http(s) URL is required' });
    return;
  }

  const baseline = method === 'POST'
    ? normalizeBaseline((body as ApiScanBody | undefined)?.baseline)
    : normalizeBaseline(undefined);

  const startedAt = Date.now();
  try {
    const scan = await runLiveScan(url);
    if (Date.now() - startedAt >= SCAN_RESPONSE_CAP_MS) {
      sendJson(res, 504, {
        ok: false,
        error: `Audit timed out after ${SCAN_RESPONSE_CAP_MS}ms`,
      });
      return;
    }
    const loss = calculateLoss(scan, baseline);
    const payload: ApiScanResponse = { ok: true, url, baseline, scan, loss };
    if (scan.error !== null) payload.error = scan.error;
    sendJson(res, 200, payload);
  } catch {
    sendJson(res, 500, { ok: false, error: 'Audit backend failure' });
  }
}

export { handleScan as handler };