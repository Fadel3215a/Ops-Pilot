import { roundWaste, toEpochMs, WASTE_USD_PER_MS } from './internal';
import type { DatabaseBottleneckAnalysis, RawLogItem } from './types';

export const DB_SLOW_QUERY_THRESHOLD_MS = 200;
export const DB_N1_IDENTICAL_MIN_REPEATS = 3;
export const DB_N1_TABLE_MIN_REPEATS = 8;
export const DB_N1_WINDOW_MS = 5000;

interface TraceEntry {
  index: number;
  ms: number;
  item: RawLogItem;
  table: string | null;
}

export function parseTableFromQuery(query: string): string | null {
  const select = /from\s+[`"']?([\w.]+)[`"']?/i.exec(query);
  if (select) return select[1];
  const into = /into\s+[`"']?([\w.]+)[`"']?/i.exec(query);
  if (into) return into[1];
  const update = /update\s+[`"']?([\w.]+)[`"']?/i.exec(query);
  if (update) return update[1];
  return null;
}

export function analyzeDatabaseQueries(
  logs: RawLogItem[],
): DatabaseBottleneckAnalysis {
  const entries: TraceEntry[] = [];

  for (const [index, item] of logs.entries()) {
    if (typeof item.query !== 'string' || item.query === '') continue;
    const ms = toEpochMs(item.timestamp);
    if (!Number.isFinite(ms)) continue;
    entries.push({
      index,
      ms,
      item,
      table: parseTableFromQuery(item.query),
    });
  }

  const flagged = new Set<number>();

  for (const entry of entries) {
    const durationMs = entry.item.durationMs;
    if (
      typeof durationMs === 'number' &&
      durationMs >= DB_SLOW_QUERY_THRESHOLD_MS
    ) {
      flagged.add(entry.index);
    }
  }

  const flagRepeatGroups = (
    keyOf: (entry: TraceEntry) => string | null,
    minRepeats: number,
  ): void => {
    const groups = new Map<string, TraceEntry[]>();
    for (const entry of entries) {
      const key = keyOf(entry);
      if (key === null) continue;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.ms - b.ms);
      const span = group[group.length - 1].ms - group[0].ms;
      if (group.length >= minRepeats && span <= DB_N1_WINDOW_MS) {
        for (let i = 1; i < group.length; i += 1) {
          flagged.add(group[i].index);
        }
      }
    }
  };

  flagRepeatGroups(
    (entry) =>
      entry.table === null
        ? null
        : `${entry.item.source}::${entry.table}`,
    DB_N1_TABLE_MIN_REPEATS,
  );
  flagRepeatGroups(
    (entry) =>
      `${entry.item.source}::${entry.item.query!.trim().toLowerCase()}`,
    DB_N1_IDENTICAL_MIN_REPEATS,
  );

  const flaggedEntries = entries.filter((entry) => flagged.has(entry.index));

  let avgSlowQueryMs = 0;
  let wasteUsd = 0;
  for (const entry of flaggedEntries) {
    const durationMs = entry.item.durationMs ?? 0;
    avgSlowQueryMs += durationMs;
    wasteUsd += durationMs * WASTE_USD_PER_MS[entry.item.source];
  }
  if (flaggedEntries.length > 0) {
    avgSlowQueryMs /= flaggedEntries.length;
  }

  return {
    slowQueryCount: flaggedEntries.length,
    avgSlowQueryMs,
    estimatedWasteUsd: roundWaste(wasteUsd),
  };
}