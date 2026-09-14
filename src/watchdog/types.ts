export interface AuditSnapshot {
  id: string;
  timestamp: string;
  targetUrl: string;
  frontendLossUsd: number;
  backendWasteUsd: number;
  combinedLossUsd: number;
  topFixId: string | null;
  performanceScore: number;
}

export interface MetricThresholds {
  monthlyLossCeilingUsd: number;
  backendWasteUsd?: number;
  performanceScore?: number;
}

export interface WatchdogConfig {
  targetUrl: string;
  intervalMinutes: number;
  logSource?: string;
}