import { roundWaste, toEpochMs, WASTE_USD_PER_MS } from './internal';
import type { RawLogItem, SyncLoopAnalysis } from './types';

export const SYNC_LOOP_WINDOW_MS = 5000;
export const SYNC_LOOP_ASSUMED_DURATION_MS = 150;

interface GroupedEntry {
  ms: number;
  item: RawLogItem;
}

export function analyzeSyncLoops(logs: RawLogItem[]): SyncLoopAnalysis {
  const groups = new Map<string, GroupedEntry[]>();

  for (const log of logs) {
    const route = log.route;
    if (typeof route !== 'string' || route === '') continue;
    const ms = toEpochMs(log.timestamp);
    if (!Number.isFinite(ms)) continue;
    const key = `${log.source}::${route}`;
    const group = groups.get(key) ?? [];
    group.push({ ms, item: log });
    groups.set(key, group);
  }

  let detectedLoopsCount = 0;
  let redundantCallCount = 0;
  let wasteUsd = 0;

  for (const entries of groups.values()) {
    entries.sort((a, b) => a.ms - b.ms);
    const windowDeque: number[] = [];
    let groupRedundant = 0;

    for (const entry of entries) {
      const windowStart = entry.ms - SYNC_LOOP_WINDOW_MS;
      while (
        windowDeque.length > 0 &&
        windowDeque[0] < windowStart
      ) {
        windowDeque.shift();
      }
      if (windowDeque.length > 0) {
        const durationMs =
          entry.item.durationMs ?? SYNC_LOOP_ASSUMED_DURATION_MS;
        groupRedundant += 1;
        wasteUsd += durationMs * WASTE_USD_PER_MS[entry.item.source];
      }
      windowDeque.push(entry.ms);
    }

    if (groupRedundant > 0) {
      detectedLoopsCount += 1;
      redundantCallCount += groupRedundant;
    }
  }

  return {
    detectedLoopsCount,
    redundantCallCount,
    estimatedWasteUsd: roundWaste(wasteUsd),
  };
}