import assert from 'node:assert/strict';
import {
  analyzeColdStarts,
  analyzeDatabaseQueries,
  analyzeSyncLoops,
  parseLogs,
} from './index';
import {
  COLD_START_BASELINE_MS,
  isColdStartItem,
} from './coldstarts';
import {
  DB_N1_IDENTICAL_MIN_REPEATS,
  DB_N1_TABLE_MIN_REPEATS,
  DB_N1_WINDOW_MS,
  DB_SLOW_QUERY_THRESHOLD_MS,
  parseTableFromQuery,
} from './dbqueries';
import {
  COLD_START_LOGS,
  DB_TRACE_LOGS,
  RAW_LOGS_FIXTURE,
  SYNC_LOOP_LOGS,
} from './fixtures';
import { roundWaste, WASTE_USD_PER_MS } from './internal';
import {
  SYNC_LOOP_ASSUMED_DURATION_MS,
  SYNC_LOOP_WINDOW_MS,
} from './syncloops';
import type { RawLogItem } from './types';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function main(): void {
  check('table name is extracted from SELECT queries', () => {
    assert.equal(
      parseTableFromQuery('SELECT * FROM orders WHERE customer_id = ?'),
      'orders',
    );
  });
  check('table name is extracted from INSERT/UPDATE queries', () => {
    assert.equal(
      parseTableFromQuery('INSERT INTO audit_logs (event) VALUES (?)'),
      'audit_logs',
    );
    assert.equal(
      parseTableFromQuery('UPDATE sessions SET token = ? WHERE id = ?'),
      'sessions',
    );
  });
  check('non-SQL input yields no table name', () => {
    assert.equal(parseTableFromQuery('healthcheck ping'), null);
    assert.equal(parseTableFromQuery(''), null);
  });

  check('isColdStartItem honors explicit flag and init phases', () => {
    const flagged: RawLogItem = {
      timestamp: '2026-09-14T10:00:00.000Z',
      source: 'aws',
      serviceName: 'init-bootstrap',
    };
    const warm: RawLogItem = {
      timestamp: '2026-09-14T10:00:00.000Z',
      source: 'aws',
      serviceName: 'orders-processor',
      isColdStart: false,
    };
    assert.equal(isColdStartItem(flagged), true);
    assert.equal(isColdStartItem(warm), false);
  });

  check('cold start analysis groups executions and sizes waste', () => {
    const result = analyzeColdStarts(COLD_START_LOGS);
    assert.equal(result.count, 4);
    assert.equal(result.totalLatencyMs, 8700);
    const expected = rawColdWaste(COLD_START_LOGS);
    assert.equal(result.estimatedWasteUsd, roundWaste(expected));
  });

  check('sync loop analysis flags rolling-window recursion', () => {
    const result = analyzeSyncLoops(SYNC_LOOP_LOGS);
    assert.equal(result.detectedLoopsCount, 2);
    assert.equal(result.redundantCallCount, 4);
    const expected = rawSyncWaste(SYNC_LOOP_LOGS);
    assert.equal(result.estimatedWasteUsd, roundWaste(expected));
  });

  check('sync loop detection respects the 5s window and assumed duration', () => {
    const base = Date.parse('2026-09-14T10:00:00.000Z');
    const mk = (
      at: string,
      source: 'aws' | 'vercel' | 'shopify',
      durationMs?: number,
    ): RawLogItem => ({
      timestamp: at,
      source,
      serviceName: 'webhook-ingest',
      durationMs,
      route: '/api/webhooks/orders/updated',
    });
    const farApart = [
      mk(new Date(base + 0).toISOString(), 'shopify', 300),
      mk(new Date(base + SYNC_LOOP_WINDOW_MS + 10).toISOString(), 'shopify', 300),
    ];
    const noDuration = [
      mk(new Date(base + 0).toISOString(), 'shopify'),
      mk(new Date(base + 100).toISOString(), 'shopify'),
    ];
    const farApartResult = analyzeSyncLoops(farApart);
    assert.equal(farApartResult.redundantCallCount, 0);
    const undurationResult = analyzeSyncLoops(noDuration);
    assert.equal(undurationResult.redundantCallCount, 1);
    assert.equal(
      undurationResult.estimatedWasteUsd,
      roundWaste(SYNC_LOOP_ASSUMED_DURATION_MS * WASTE_USD_PER_MS.shopify),
    );
  });

  check('database trace analysis flags slow queries and N+1 bursts', () => {
    const result = analyzeDatabaseQueries(DB_TRACE_LOGS);
    assert.equal(result.slowQueryCount, 15);
    assert.ok(Math.abs(result.avgSlowQueryMs - 1880 / 15) < 1e-9);
    const expected = rawDbWaste(DB_TRACE_LOGS);
    assert.equal(result.estimatedWasteUsd, roundWaste(expected));
  });

  check('database trace analysis ignores fast one-off queries', () => {
    const fast: RawLogItem[] = [
      {
        timestamp: '2026-09-14T10:00:00.000Z',
        source: 'aws',
        serviceName: 'inventory-db-query',
        durationMs: 45,
        query: 'SELECT * FROM inventory WHERE sku = ?',
      },
    ];
    const result = analyzeDatabaseQueries(fast);
    assert.equal(result.slowQueryCount, 0);
    assert.equal(result.avgSlowQueryMs, 0);
    assert.equal(result.estimatedWasteUsd, 0);
  });

  check('parseLogs aggregates parsed counts and backend waste', () => {
    const result = parseLogs(RAW_LOGS_FIXTURE);
    assert.equal(result.summary.totalLogsParsed, RAW_LOGS_FIXTURE.length);
    const cold = analyzeColdStarts(RAW_LOGS_FIXTURE);
    const sync = analyzeSyncLoops(RAW_LOGS_FIXTURE);
    const db = analyzeDatabaseQueries(RAW_LOGS_FIXTURE);
    assert.equal(
      result.summary.totalBackendWasteUsd,
      roundWaste(cold.estimatedWasteUsd + sync.estimatedWasteUsd + db.estimatedWasteUsd),
    );
    assert.equal(result.coldStarts.estimatedWasteUsd, cold.estimatedWasteUsd);
    assert.equal(result.syncLoops.redundantCallCount, sync.redundantCallCount);
    assert.equal(result.databaseBottlenecks.slowQueryCount, db.slowQueryCount);
  });

  check('unparseable timestamps are excluded from metrics', () => {
    const junk: RawLogItem[] = [
      ...COLD_START_LOGS,
      {
        timestamp: 'not-a-date',
        source: 'aws',
        serviceName: 'ghost',
      },
    ];
    const without = analyzeColdStarts(COLD_START_LOGS);
    const withJunk = analyzeColdStarts(junk);
    assert.deepEqual(withJunk, without);
    const full = parseLogs(junk);
    assert.equal(full.summary.totalLogsParsed, junk.length);
  });

  check('cost model constants drive deterministic waste math', () => {
    assert.equal(DB_SLOW_QUERY_THRESHOLD_MS, 200);
    assert.equal(DB_N1_IDENTICAL_MIN_REPEATS, 3);
    assert.equal(DB_N1_TABLE_MIN_REPEATS, 8);
    assert.equal(DB_N1_WINDOW_MS, 5000);
    assert.equal(SYNC_LOOP_WINDOW_MS, 5000);
    assert.equal(COLD_START_BASELINE_MS, 100);
    assert.equal(WASTE_USD_PER_MS.aws > WASTE_USD_PER_MS.vercel, true);
    assert.equal(WASTE_USD_PER_MS.vercel > WASTE_USD_PER_MS.shopify, true);
  });

  console.log(`\nParser: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function rawColdWaste(logs: RawLogItem[]): number {
  let total = 0;
  for (const log of logs) {
    if (!isColdStartItem(log)) continue;
    const latency = log.durationMs ?? 0;
    const excess = Math.max(0, latency - COLD_START_BASELINE_MS);
    total += excess * WASTE_USD_PER_MS[log.source];
  }
  return total;
}

function rawSyncWaste(logs: RawLogItem[]): number {
  let total = 0;
  const groups = new Map<string, { ms: number; item: RawLogItem }[]>();
  for (const log of logs) {
    if (typeof log.route !== 'string' || log.route === '') continue;
    const ms = Date.parse(log.timestamp);
    const key = `${log.source}::${log.route}`;
    const group = groups.get(key) ?? [];
    group.push({ ms, item: log });
    groups.set(key, group);
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.ms - b.ms);
    const deque: number[] = [];
    for (const entry of entries) {
      const windowStart = entry.ms - SYNC_LOOP_WINDOW_MS;
      while (deque.length > 0 && deque[0] < windowStart) deque.shift();
      if (deque.length > 0) {
        total +=
          (entry.item.durationMs ?? SYNC_LOOP_ASSUMED_DURATION_MS) *
          WASTE_USD_PER_MS[entry.item.source];
      }
      deque.push(entry.ms);
    }
  }
  return total;
}

function rawDbWaste(logs: RawLogItem[]): number {
  const flagged = new Set<number>();
  const entries: { index: number; item: RawLogItem; table: string | null }[] = [];
  for (const [index, item] of logs.entries()) {
    if (typeof item.query !== 'string' || item.query === '') continue;
    entries.push({ index, item, table: parseTableFromQuery(item.query) });
  }
  for (const entry of entries) {
    if (
      typeof entry.item.durationMs === 'number' &&
      entry.item.durationMs >= DB_SLOW_QUERY_THRESHOLD_MS
    ) {
      flagged.add(entry.index);
    }
  }
  const flagGroups = (keyOf: (e: typeof entries[number]) => string | null, min: number): void => {
    const groups = new Map<string, (typeof entries)[number][]>();
    for (const entry of entries) {
      const key = keyOf(entry);
      if (key === null) continue;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length >= min) {
        for (let i = 1; i < group.length; i += 1) flagged.add(group[i].index);
      }
    }
  };
  flagGroups((e) => (e.table === null ? null : `${e.item.source}::${e.table}`), DB_N1_TABLE_MIN_REPEATS);
  flagGroups((e) => `${e.item.source}::${e.item.query!.trim().toLowerCase()}`, DB_N1_IDENTICAL_MIN_REPEATS);
  let total = 0;
  for (const entry of entries) {
    if (!flagged.has(entry.index)) continue;
    total += (entry.item.durationMs ?? 0) * WASTE_USD_PER_MS[entry.item.source];
  }
  return total;
}

main();