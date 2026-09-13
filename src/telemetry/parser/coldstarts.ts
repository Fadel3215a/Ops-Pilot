import { roundWaste, toEpochMs, WASTE_USD_PER_MS } from './internal';
import type { ColdStartAnalysis, RawLogItem } from './types';

export const COLD_START_BASELINE_MS = 100;

export function isColdStartItem(log: RawLogItem): boolean {
  if (log.isColdStart === true) return true;
  const route = (log.route ?? '').toLowerCase();
  const service = log.serviceName.toLowerCase();
  return route.includes('init') || service.includes('init');
}

export function analyzeColdStarts(logs: RawLogItem[]): ColdStartAnalysis {
  const groups = new Map<
    string,
    { count: number; totalLatencyMs: number; wasteUsd: number }
  >();

  for (const log of logs) {
    if (!isColdStartItem(log)) continue;
    if (!Number.isFinite(toEpochMs(log.timestamp))) continue;

    const entry = groups.get(log.serviceName) ?? {
      count: 0,
      totalLatencyMs: 0,
      wasteUsd: 0,
    };
    const latency = log.durationMs ?? 0;
    const excess = Math.max(0, latency - COLD_START_BASELINE_MS);
    entry.count += 1;
    entry.totalLatencyMs += latency;
    entry.wasteUsd += excess * WASTE_USD_PER_MS[log.source];
    groups.set(log.serviceName, entry);
  }

  let count = 0;
  let totalLatencyMs = 0;
  let wasteUsd = 0;
  for (const entry of groups.values()) {
    count += entry.count;
    totalLatencyMs += entry.totalLatencyMs;
    wasteUsd += entry.wasteUsd;
  }

  return {
    count,
    totalLatencyMs,
    estimatedWasteUsd: roundWaste(wasteUsd),
  };
}