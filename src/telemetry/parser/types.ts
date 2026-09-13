export type LogSource = 'aws' | 'vercel' | 'shopify';

export interface RawLogItem {
  timestamp: string;
  source: LogSource;
  serviceName: string;
  durationMs?: number;
  isColdStart?: boolean;
  statusCode?: number;
  route?: string;
  query?: string;
}

export interface ColdStartAnalysis {
  count: number;
  totalLatencyMs: number;
  estimatedWasteUsd: number;
}

export interface SyncLoopAnalysis {
  detectedLoopsCount: number;
  redundantCallCount: number;
  estimatedWasteUsd: number;
}

export interface DatabaseBottleneckAnalysis {
  slowQueryCount: number;
  avgSlowQueryMs: number;
  estimatedWasteUsd: number;
}

export interface ParsedLogAnalysis {
  summary: {
    totalLogsParsed: number;
    totalBackendWasteUsd: number;
  };
  coldStarts: ColdStartAnalysis;
  syncLoops: SyncLoopAnalysis;
  databaseBottlenecks: DatabaseBottleneckAnalysis;
}