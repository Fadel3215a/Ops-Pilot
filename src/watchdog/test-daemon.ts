import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RAW_LOGS_FIXTURE } from '../telemetry/parser/fixtures';
import {
  clearHistory,
  loadHistory,
  parseDaemonArgs,
  runAuditCycle,
  runDaemonFromCli,
  saveSnapshot,
  syntheticScanResult,
  WatchdogDaemon,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

interface WebhookCall {
  url: string;
  body: Record<string, unknown>;
}

function mockFetch(calls: WebhookCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body:
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
}

const TEMP_DIR = os.tmpdir();

function tempHistoryFile(): string {
  return path.join(
    TEMP_DIR,
    `watchdog-daemon.${process.pid}.${Math.random().toString(36).slice(2)}.json`,
  );
}

async function withTempHistory<T>(
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const file = tempHistoryFile();
  await clearHistory(file);
  try {
    return await fn(file);
  } finally {
    await rm(file, { force: true });
  }
}

function seedPrevious(score: number): AuditSnapshot {
  return {
    id: 'previous-snapshot',
    timestamp: '2026-01-01T00:00:00.000Z',
    targetUrl: 'https://store.example.com/',
    frontendLossUsd: 0,
    backendWasteUsd: 0,
    combinedLossUsd: 0,
    topFixId: null,
    performanceScore: score,
  };
}

async function main(): Promise<void> {
  await run('parseDaemonArgs parses all flags with defaults', () => {
    const parsed = parseDaemonArgs([
      '--target=https://store.example.com/',
      '--interval=30',
      '--webhook=https://hooks.slack.com/services/T',
      '--once',
    ]);
    assert.strictEqual(parsed.targetUrl, 'https://store.example.com/');
    assert.strictEqual(parsed.intervalMinutes, 30);
    assert.strictEqual(parsed.webhookUrl, 'https://hooks.slack.com/services/T');
    assert.strictEqual(parsed.once, true);
  });

  await run('parseDaemonArgs defaults interval to 15 minutes', () => {
    const parsed = parseDaemonArgs(['--target=https://store.example.com/']);
    assert.strictEqual(parsed.intervalMinutes, 15);
    assert.strictEqual(parsed.once, false);
    assert.strictEqual(parsed.webhookUrl, undefined);
  });

  await run('parseDaemonArgs rejects missing target', () => {
    let threw = false;
    try {
      parseDaemonArgs(['--interval=10']);
    } catch (error) {
      threw = String(error).includes('--target');
    }
    assert.ok(threw);
  });

  await run('parseDaemonArgs rejects invalid interval', () => {
    let threw = false;
    try {
      parseDaemonArgs(['--target=https://x', '--interval=abc']);
    } catch (error) {
      threw = String(error).includes('Invalid --interval');
    }
    assert.ok(threw);
  });

  await run('daemon tick persists a snapshot and returns it', () =>
    withTempHistory(async (file) => {
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 60_000,
        historyPath: file,
        scan: syntheticScanResult,
        logItems: RAW_LOGS_FIXTURE,
      });
      const snapshot = await daemon.tick();
      assert.strictEqual(snapshot.targetUrl, 'https://store.example.com/');
      assert.ok(snapshot.combinedLossUsd > 0);
      const history = await loadHistory(file);
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].id, snapshot.id);
      assert.strictEqual(daemon.tickCount, 1);
    }),
  );

  await run('daemon tick evaluates alerts and dispatches to webhook', () =>
    withTempHistory(async (file) => {
      const calls: WebhookCall[] = [];
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 60_000,
        webhookUrl: 'https://hooks.example.com/alert',
        historyPath: file,
        scan: syntheticScanResult,
        logItems: RAW_LOGS_FIXTURE,
        fetchFn: mockFetch(calls),
      });
      const snapshot = await daemon.tick();
      assert.ok(daemon.lastTickAlerts.length > 0, 'rules fired');
      assert.ok(daemon.lastDispatched > 0, 'alerts dispatched');
      assert.ok(
        calls.every((call) => call.url === 'https://hooks.example.com/alert'),
      );
      assert.ok(
        calls.some((call) => String(call.body.text).includes('Loss Ceiling')),
      );
      assert.ok(snapshot.combinedLossUsd > 10_000);
    }),
  );

  await run('daemon regression fires on drop vs persisted previous', () =>
    withTempHistory(async (file) => {
      await saveSnapshot(seedPrevious(100), file);
      const calls: WebhookCall[] = [];
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 60_000,
        webhookUrl: 'https://hooks.example.com/alert',
        historyPath: file,
        scan: syntheticScanResult,
        fetchFn: mockFetch(calls),
      });
      await daemon.tick();
      const headlines = daemon.lastTickAlerts.map((alert) => alert.headline);
      assert.ok(
        headlines.some((h) => h.includes('Performance Regression')),
        'regression dispatched against previous score 100',
      );
      assert.ok(
        calls.some((call) => String(call.body.text).includes('Regression')),
      );
    }),
  );

  await run('daemon lifecycle: start schedules ticks and stop freezes them', async () => {
    await withTempHistory(async (file) => {
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 10,
        historyPath: file,
        scan: syntheticScanResult,
      });
      assert.strictEqual(daemon.isRunning(), false);

      daemon.start();
      assert.strictEqual(daemon.isRunning(), true);

      const reached = await until(() => daemon.tickCount >= 2, 2_000);
      assert.ok(reached, 'daemon ticked more than once on schedule');

      daemon.stop();
      assert.strictEqual(daemon.isRunning(), false);

      await sleep(30);
      const frozen = daemon.tickCount;
      await sleep(80);
      assert.strictEqual(daemon.tickCount, frozen, 'no ticks after stop');

      const history = await loadHistory(file);
      assert.ok(history.length >= 2, 'interval audits persisted');
    });
  });

  await run('daemon start is idempotent (single timer)', async () => {
    await withTempHistory(async (file) => {
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 10,
        historyPath: file,
        scan: syntheticScanResult,
      });
      daemon.start();
      daemon.start();
      daemon.start();
      await until(() => daemon.tickCount >= 2, 2_000);
      await sleep(120);
      daemon.stop();
      assert.ok(
        daemon.tickCount <= 30,
        `single timer implied, got ${daemon.tickCount}`,
      );
    });
  });

  await run('daemon stop before start is a safe no-op', () => {
    const daemon = new WatchdogDaemon({
      targetUrl: 'https://store.example.com/',
      intervalMs: 60_000,
      scan: syntheticScanResult,
    });
    daemon.stop();
    assert.strictEqual(daemon.isRunning(), false);
    assert.strictEqual(daemon.tickCount, 0);
  });

  await run('daemon constructor rejects non-positive interval', () => {
    let threw = false;
    try {
      new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 0,
      });
    } catch (error) {
      threw = String(error).includes('intervalMs');
    }
    assert.ok(threw);
  });

  await run('runDaemonFromCli --once audits, persists, and returns 1', () =>
    withTempHistory(async (file) => {
      const result = await runDaemonFromCli(
        [
          '--target=https://store.example.com/',
          '--interval=5',
          '--once',
        ],
        { scan: syntheticScanResult, historyPath: file },
      );
      assert.strictEqual(result, 1);
      const history = await loadHistory(file);
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].targetUrl, 'https://store.example.com/');
    }),
  );

  await run('runDaemonFromCli --once dispatches to configured webhook', () =>
    withTempHistory(async (file) => {
      const calls: WebhookCall[] = [];
      const result = await runDaemonFromCli(
        [
          '--target=https://store.example.com/',
          '--webhook=https://hooks.slack.com/services/T/CH',
          '--once',
        ],
        { scan: syntheticScanResult, historyPath: file, fetchFn: mockFetch(calls) },
      );
      assert.strictEqual(result, 1);
      assert.ok(calls.length > 0, 'webhook dispatched');
      assert.ok(
        calls.every((call) =>
          call.url.startsWith('https://hooks.slack.com/services/T/CH'),
        ),
      );
    }),
  );

  await run('runDaemonFromCli returns 0 on parse failure', async () => {
    const result = await runDaemonFromCli(['--interval=5'], {});
    assert.strictEqual(result, 0);
  });

  await run('runAuditCycle provenance remains intact through daemon tick', () =>
    withTempHistory(async (file) => {
      const direct = await runAuditCycle('https://store.example.com/', [], {
        scan: syntheticScanResult,
      });
      const daemon = new WatchdogDaemon({
        targetUrl: 'https://store.example.com/',
        intervalMs: 60_000,
        historyPath: file,
        scan: syntheticScanResult,
      });
      const viaDaemon = await daemon.tick();
      assert.strictEqual(viaDaemon.frontendLossUsd, direct.frontendLossUsd);
      assert.strictEqual(viaDaemon.performanceScore, direct.performanceScore);
    }),
  );

  console.log(`\nWatchdog daemon: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});