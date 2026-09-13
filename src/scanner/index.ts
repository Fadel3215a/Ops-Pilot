import { chromium, type Browser, type Page } from 'playwright';
import { analyzeSecurityHeaders } from './headers';
import { collectDomStats } from './dom';
import { NetworkMonitor } from './network';
import {
  PERFORMANCE_OBSERVER_INIT_SCRIPT,
  computeBlockingTime,
  readLcp,
  readLongTasks,
  readPerfTiming,
  waitForLcp,
} from './performance';
import type { ScanResult } from './types';

export const SCAN_TIMEOUT_MS = 30_000;
export const NAVIGATION_TIMEOUT_MS = 30_000;
export const LCP_WAIT_MS = 5_000;

const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

export function emptyScanResult(url: string): ScanResult {
  return {
    url,
    timestamp: new Date().toISOString(),
    performance: { ttfb: 0, lcp: 0, totalBlockingTime: 0, totalPayloadBytes: 0 },
    dom: { totalNodes: 0, maxDepth: 0, scriptTagCount: 0, inlineScriptCount: 0, externalScriptCount: 0 },
    thirdParty: { scriptCount: 0, payloadBytes: 0, domains: [] },
    securityHeaders: { hsts: false, csp: false, xFrameOptions: null, xContentTypeOptions: false, score: 0 },
    payloadBytesByType: { javascript: 0, css: 0, image: 0, font: 0 },
    error: null,
  };
}

async function runScan(url: string): Promise<ScanResult> {
  const result = emptyScanResult(url);
  let browser: Browser | null = null;

  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: DESKTOP_CHROME_UA });
    const page: Page = await context.newPage();
    await page.addInitScript(PERFORMANCE_OBSERVER_INIT_SCRIPT);

    const network = new NetworkMonitor(url);
    page.on('response', (response) => {
      void network.record(response).catch(() => undefined);
    });

    const response = await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    if (!response) throw new Error('No navigation response received');

    result.securityHeaders = analyzeSecurityHeaders(response.headers());
    result.dom = await page.evaluate(collectDomStats);

    const [longTasks, timing, lcp] = await Promise.all([
      readLongTasks(page),
      readPerfTiming(page),
      waitForLcp(page, LCP_WAIT_MS),
    ]);

    result.performance.ttfb = timing.ttfb;
    result.performance.lcp = lcp;
    result.performance.totalBlockingTime = computeBlockingTime(longTasks);

    const stats = network.getStats();
    result.thirdParty = stats.thirdParty;
    result.payloadBytesByType = stats.payloadBytesByType;
    result.performance.totalPayloadBytes = stats.totalPayloadBytes;

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  } finally {
    await browser?.close();
  }
}

export async function scanUrl(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<ScanResult> {
  return new Promise<ScanResult>((resolve) => {
    const hardTimer = setTimeout(() => {
      const result = emptyScanResult(url);
      result.error = `Scan timed out after ${SCAN_TIMEOUT_MS}ms`;
      resolve(result);
    }, SCAN_TIMEOUT_MS);

    const abort = (): void => {
      clearTimeout(hardTimer);
      const result = emptyScanResult(url);
      result.error = 'Scan aborted by caller';
      resolve(result);
    };

    const signal = options?.signal;
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });

    void runScan(url)
      .then((result) => {
        clearTimeout(hardTimer);
        signal?.removeEventListener('abort', abort);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(hardTimer);
        signal?.removeEventListener('abort', abort);
        resolve(emptyScanResult(url));
      });
  });
}