import type { LossAnalysis } from '../src/engine/types';
import type { ScanResult } from '../src/scanner/types';
import { calculateLoss } from '../src/engine';
import { scanUrl } from '../src/scanner';
import { DEFAULT_BASELINE, type StoreBaseline } from '../src/engine/types';

export const config = { maxDuration: 60 };

export const SCAN_RESPONSE_CAP_MS = 35_000;

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

export default async function handleScan(req: ScanRequest, res: ScanResponse): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const url = normalizeUrl((body as ApiScanBody | undefined)?.url);
  if (url === null) {
    sendJson(res, 400, { ok: false, error: 'A valid http(s) URL is required' });
    return;
  }
  const baseline = normalizeBaseline((body as ApiScanBody | undefined)?.baseline);

  const controller = new AbortController();
  const capTimer = setTimeout(() => controller.abort(), SCAN_RESPONSE_CAP_MS);

  try {
    const scan = await scanUrl(url, { signal: controller.signal });
    if (controller.signal.aborted) {
      sendJson(res, 504, {
        ok: false,
        error: `Audit timed out after ${SCAN_RESPONSE_CAP_MS}ms`,
      });
      return;
    }
    const loss = calculateLoss(scan, baseline);
    const payload: ApiScanResponse = { ok: true, url, baseline, scan, loss };
    if (scan.error) payload.error = scan.error;
    sendJson(res, 200, payload);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: 'Audit backend failure' });
  } finally {
    clearTimeout(capTimer);
  }
}

export { handleScan as handler };