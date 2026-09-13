import { analyzeColdStarts } from './coldstarts';
import { analyzeDatabaseQueries } from './dbqueries';
import { roundWaste } from './internal';
import { analyzeSyncLoops } from './syncloops';
import type { ParsedLogAnalysis, RawLogItem } from './types';

export * from './coldstarts';
export * from './dbqueries';
export * from './fixtures';
export * from './internal';
export * from './syncloops';
export * from './types';

export function parseLogs(logs: RawLogItem[]): ParsedLogAnalysis {
  const coldStarts = analyzeColdStarts(logs);
  const syncLoops = analyzeSyncLoops(logs);
  const databaseBottlenecks = analyzeDatabaseQueries(logs);

  const totalBackendWasteUsd = roundWaste(
    coldStarts.estimatedWasteUsd +
      syncLoops.estimatedWasteUsd +
      databaseBottlenecks.estimatedWasteUsd,
  );

  return {
    summary: {
      totalLogsParsed: logs.length,
      totalBackendWasteUsd,
    },
    coldStarts,
    syncLoops,
    databaseBottlenecks,
  };
}