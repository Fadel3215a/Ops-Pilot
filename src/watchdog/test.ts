import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RAW_LOGS_FIXTURE } from '../telemetry/parser/fixtures';
import {
  clearHistory,
  computePerformanceScore,
  DEFAULT_HISTORY_PATH,
  HISTORY_LIMIT,
  loadHistory,
  pristineScanResult,
  runAuditCycle,
  saveSnapshot,
  syntheticScanResult,
} from './index';
import type { AuditSnapshot } from './types';

let passed = 0;
let failed = 0;

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${String(error).split('\n').slice(0, 4).join('\n      ')}`,
    );
  }
}

const TEMP_HISTORY = path.join(os.tmpdir(), 'watchdog-history.test.json');

async function withTempHistory<T>(
  fn: (file: string) => Promise<T>,
): Promise<T> {
  await clearHistory(TEMP_HISTORY);
  try {
    return await fn(TEMP_HISTORY);
  } finally {
    await rm(TEMP_HISTORY, { force: true });
  }
}

function sampleSnapshot(id: string): AuditSnapshot {
  return {
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    targetUrl: 'https://example.com',
    frontendLossUsd: 100,
    backendWasteUsd: 20,
    combinedLossUsd: 120,
    topFixId: 'LCP_IMAGE_PRELOAD',
    performanceScore: 88,
  };
}

async function main(): Promise<void> {
  await run('performance score maps loss to a 0-100 scale', () => {
    assert.strictEqual(computePerformanceScore(0), 100);
    assert.strictEqual(computePerformanceScore(10_000), 50);
    assert.strictEqual(computePerformanceScore(20_000), 0);
    assert.strictEqual(computePerformanceScore(99_999), 0);
    assert.strictEqual(computePerformanceScore(-5), 100);
  });

  await run('loadHistory returns empty array for missing file', () =>
    withTempHistory(async (file) => {
      const history = await loadHistory(file);
      assert.deepStrictEqual(history, []);
    }),
  );

  await run('saveSnapshot appends and persists a snapshot', () =>
    withTempHistory(async (file) => {
      const snapshot = sampleSnapshot('snapshot-1');
      const next = await saveSnapshot(snapshot, file);
      assert.strictEqual(next.length, 1);
      const reloaded = await loadHistory(file);
      assert.deepStrictEqual(reloaded, [snapshot]);
    }),
  );

  await run('history keeps a rolling window of the last 100 snapshots', () =>
    withTempHistory(async (file) => {
      for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
        const snapshot = sampleSnapshot(`id-${i}`);
        snapshot.timestamp = new Date(2026, 0, 1, 0, i).toISOString();
        snapshot.frontendLossUsd = i;
        snapshot.combinedLossUsd = i;
        snapshot.topFixId = null;
        await saveSnapshot(snapshot, file);
      }
      const history = await loadHistory(file);
      assert.strictEqual(history.length, HISTORY_LIMIT);
      assert.strictEqual(history[0].id, 'id-5');
      assert.strictEqual(history[HISTORY_LIMIT - 1].id, 'id-104');
    }),
  );

  await run('default history path resolves under data/', () => {
    assert.ok(DEFAULT_HISTORY_PATH.includes('data'));
    assert.ok(DEFAULT_HISTORY_PATH.endsWith('watchdog-history.json'));
  });

  await run('audit cycle builds a complete snapshot', () =>
    runAuditCycle('https://store.example.com/', RAW_LOGS_FIXTURE, {
      scan: syntheticScanResult,
    }).then((snapshot) => {
      assert.match(snapshot.id, /^[0-9a-f-]{36}$/);
      assert.ok(!Number.isNaN(Date.parse(snapshot.timestamp)));
      assert.strictEqual(snapshot.targetUrl, 'https://store.example.com/');
      assert.ok(snapshot.frontendLossUsd > 0, 'frontend loss present');
      assert.ok(
        snapshot.backendWasteUsd > 0,
        'backend waste reflects parsed logs',
      );
      assert.strictEqual(
        snapshot.combinedLossUsd,
        Math.round(snapshot.frontendLossUsd + snapshot.backendWasteUsd),
      );
      assert.ok(snapshot.topFixId !== null, 'a top fix is ranked');
      assert.match(snapshot.topFixId ?? '', /^[A-Z_]+$/);
      assert.ok(
        snapshot.performanceScore >= 0 && snapshot.performanceScore <= 100,
      );
    }),
  );

  await run('audit cycle is deterministic for identical inputs', () => {
    const options = { scan: syntheticScanResult };
    return Promise.all([
      runAuditCycle('https://store.example.com/', RAW_LOGS_FIXTURE, options),
      runAuditCycle('https://store.example.com/', RAW_LOGS_FIXTURE, options),
    ]).then(([a, b]) => {
      assert.strictEqual(a.frontendLossUsd, b.frontendLossUsd);
      assert.strictEqual(a.backendWasteUsd, b.backendWasteUsd);
      assert.strictEqual(a.combinedLossUsd, b.combinedLossUsd);
      assert.strictEqual(a.performanceScore, b.performanceScore);
      assert.strictEqual(a.topFixId, b.topFixId);
      assert.notStrictEqual(a.id, b.id);
    });
  });

  await run('audit cycle with no logs reports zero backend waste', () =>
    runAuditCycle('https://store.example.com/', [], {
      scan: syntheticScanResult,
    }).then((snapshot) => {
      assert.strictEqual(snapshot.backendWasteUsd, 0);
      assert.strictEqual(snapshot.combinedLossUsd, snapshot.frontendLossUsd);
    }),
  );

  await run('pristine storefront yields perfect score and no top fix', () =>
    runAuditCycle('https://store.example.com/', [], {
      scan: pristineScanResult,
    }).then((snapshot) => {
      assert.strictEqual(snapshot.frontendLossUsd, 0);
      assert.strictEqual(snapshot.backendWasteUsd, 0);
      assert.strictEqual(snapshot.combinedLossUsd, 0);
      assert.strictEqual(snapshot.topFixId, null);
      assert.strictEqual(snapshot.performanceScore, 100);
    }),
  );

  await run('custom thresholds shift the performance score', () =>
    runAuditCycle('https://store.example.com/', [], {
      scan: syntheticScanResult,
      thresholds: { monthlyLossCeilingUsd: 2_000 },
    }).then((snapshot) => {
      assert.strictEqual(snapshot.performanceScore, 0);
    }),
  );

  await run('audit cycle snapshot persists into history', () =>
    withTempHistory(async (file) => {
      const snapshot = await runAuditCycle(
        'https://store.example.com/',
        RAW_LOGS_FIXTURE,
        { scan: syntheticScanResult },
      );
      const next = await saveSnapshot(snapshot, file);
      assert.strictEqual(next.length, 1);
      const reloaded = await loadHistory(file);
      assert.deepStrictEqual(reloaded, [snapshot]);
    }),
  );

  console.log(`\nWatchdog core: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});