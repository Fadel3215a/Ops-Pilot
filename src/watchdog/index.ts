export {
  BACKEND_WASTE_USD,
  CRITICAL_BACKEND_WASTE,
  defaultRules,
  dispatchAlerts,
  evaluateAlerts,
  LOSS_CEILING_EXCEEDED,
  LOSS_CEILING_USD,
  PERFORMANCE_REGRESSION,
  REGRESSION_SCORE_DROP,
} from './alerts';
export type { AlertPayload, AlertTriggerRule } from './alerts';
export {
  computePerformanceScore,
  DEFAULT_MONTHLY_LOSS_CEILING_USD,
  DEFAULT_THRESHOLDS,
  pristineScanResult,
  runAuditCycle,
  syntheticScanResult,
} from './core';
export type { RunAuditCycleOptions } from './core';
export {
  clearHistory,
  DEFAULT_HISTORY_PATH,
  HISTORY_LIMIT,
  loadHistory,
  saveSnapshot,
} from './history';
export type { AuditSnapshot, MetricThresholds, WatchdogConfig } from './types';