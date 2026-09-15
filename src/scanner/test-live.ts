import assert from 'node:assert/strict';
import { scanUrlLive, SCAN_API_PATH } from './live-scanner';
import type { ScanResult } from './types';

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const TARGET_URL = 'https://demo-store.myshopify.com/';

const GOOD_SCAN: ScanResult = {
  url: TARGET_URL,
  timestamp: '2026-01-01T00:00:00.000Z',
  performance: { ttfb: 180, lcp: 1240, totalBlockingTime: 210, totalPayloadBytes: 3_420_000 },
  dom: { totalNodes: 412, maxDepth: 18, scriptTagCount: 4, inlineScriptCount: 1, externalScriptCount: 3 },
  thirdParty: { scriptCount: 2, payloadBytes: 88_000, domains: ['cdn.example.com', 'analytics.example.net'] },
  securityHeaders: { hsts: true, csp: true, xFrameOptions: 'DENY', xContentTypeOptions: true, score: 100 },
  payloadBytesByType: { javascript: 1_900_000, css: 340_000, image: 950_000, font: 210_000 },
  error: null,
};

interface CapturedRequest {
  url: string;
  method: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function capture(fn: FetchLike): Promise<{ calls: CapturedRequest[]; run: () => Promise<ScanResult> }> {
  const calls: CapturedRequest[] = [];
  const run = (): Promise<ScanResult> =>
    scanUrlLive(TARGET_URL, {
      fetchFn: (input, init) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        return fn(String(input), init);
      },
    });
  return { calls, run };
}

async function main(): Promise<void> {
  await check('live scan requests the API with an encoded query URL', async () => {
    const { calls, run } = await capture(() => Promise.resolve(jsonResponse(200, { ok: true, scan: GOOD_SCAN })));
    await run();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, `${SCAN_API_PATH}?url=${encodeURIComponent(TARGET_URL)}`);
  });

  await check('live scan resolves the server ScanResult unchanged', async () => {
    const { run } = await capture(() => Promise.resolve(jsonResponse(200, { ok: true, scan: GOOD_SCAN })));
    const result = await run();
    assert.deepEqual(result, GOOD_SCAN);
    assert.equal(result.error, null);
    assert.equal(result.performance.lcp, 1240);
  });

  await check('live scan falls back to synthetic on non-2xx API response', async () => {
    const { run } = await capture(() => Promise.resolve(jsonResponse(502, { ok: false, error: 'boom' })));
    const result = await run();
    assert.match(result.error ?? '', /HTTP 502/);
    assert.equal(result.performance.lcp, 0);
    assert.equal(result.performance.totalPayloadBytes, 0);
  });

  await check('live scan falls back to synthetic when scan data is missing', async () => {
    const { run } = await capture(() => Promise.resolve(jsonResponse(200, { ok: true })));
    const result = await run();
    assert.match(result.error ?? '', /no scan data/);
    assert.equal(result.dom.totalNodes, 0);
  });

  await check('live scan falls back to synthetic when fetch rejects', async () => {
    const { run } = await capture(() => Promise.reject(new Error('network unreachable')));
    const result = await run();
    assert.match(result.error ?? '', /network unreachable/);
  });

  await check('live scan surfaces partial API scan errors unchanged', async () => {
    const partial: ScanResult = { ...GOOD_SCAN, error: 'Security header fetch failed: denied', securityHeaders: { hsts: false, csp: false, xFrameOptions: null, xContentTypeOptions: false, score: 0 } };
    const { run } = await capture(() => Promise.resolve(jsonResponse(200, { ok: true, scan: partial })));
    const result = await run();
    assert.deepEqual(result, partial);
    assert.match(result.error ?? '', /Security header/);
  });

  await check('live scan falls back to synthetic on invalid JSON payload', async () => {
    const { run } = await capture(async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const result = await run();
    assert.match(result.error ?? '', /Live scan failed/);
  });

  await check('live scan synthetic result carries the target url and timestamp', async () => {
    const { run } = await capture(() => Promise.resolve(jsonResponse(500, {})));
    const result = await run();
    assert.equal(result.url, TARGET_URL);
    assert.ok(!Number.isNaN(new Date(result.timestamp).getTime()));
  });

  await check('live scan aborting the caller signal produces an abort fallback', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await scanUrlLive(TARGET_URL, {
      signal: controller.signal,
      fetchFn: () => new Promise<Response>(() => undefined),
    });
    assert.match(result.error ?? '', /aborted by caller/);
  });

  console.log('');
  console.log(`Live scanner: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected test runner failure:', err);
  process.exitCode = 1;
});