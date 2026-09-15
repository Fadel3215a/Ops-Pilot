import type { ScanResult } from './types';

export const SCAN_API_PATH = '/api/scan';
export const SCAN_REQUEST_TIMEOUT_MS = 35_000;

export interface ScanUrlLiveOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export function syntheticScanResult(url: string, error: string): ScanResult {
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
    error,
  };
}

export async function scanUrlLive(url: string, options?: ScanUrlLiveOptions): Promise<ScanResult> {
  const perform = options?.fetchFn ?? fetch;
  const callerSignal = options?.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);

  const onCallerAbort = (): void => controller.abort();
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const requestUrl = `${SCAN_API_PATH}?url=${encodeURIComponent(url)}`;

  try {
    const response = await perform(requestUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      return syntheticScanResult(url, `Scan endpoint returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { ok?: unknown; scan?: ScanResult | null; error?: string };
    if (payload.scan === null || payload.scan === undefined || typeof payload.scan !== 'object') {
      return syntheticScanResult(url, payload.error ?? 'Scan endpoint returned no scan data');
    }
    return payload.scan;
  } catch (err) {
    if (callerSignal?.aborted === true) {
      return syntheticScanResult(url, 'Scan aborted by caller');
    }
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Scan request timed out'
      : err instanceof Error
        ? err.message
        : String(err);
    return syntheticScanResult(url, `Live scan failed: ${message}`);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}