import { calculateLoss } from '../engine';
import type { StoreBaseline } from '../engine/types';
import { parseLogs } from '../telemetry/parser';
import type { RawLogItem } from '../telemetry/parser/types';
import { generateRemediationPlan } from '../remediation';
import { emptyScanResult, scanUrl } from '../scanner';
import type { ScanResult } from '../scanner/types';
import type { AuditSnapshot, MetricThresholds } from './types';

export const DEFAULT_MONTHLY_LOSS_CEILING_USD = 20_000;

export const DEFAULT_THRESHOLDS: MetricThresholds = {
  monthlyLossCeilingUsd: DEFAULT_MONTHLY_LOSS_CEILING_USD,
};

export interface RunAuditCycleOptions {
  scan?: (url: string) => Promise<ScanResult> | ScanResult;
  baseline?: StoreBaseline;
  thresholds?: MetricThresholds;
}

export function computePerformanceScore(
  combinedLossUsd: number,
  thresholds: MetricThresholds = DEFAULT_THRESHOLDS,
): number {
  const ceiling = Math.max(1, thresholds.monthlyLossCeilingUsd);
  const ratio = Math.min(1, Math.max(0, combinedLossUsd / ceiling));
  return Math.round((1 - ratio) * 100);
}

export async function runAuditCycle(
  targetUrl: string,
  logItems: RawLogItem[] = [],
  options: RunAuditCycleOptions = {},
): Promise<AuditSnapshot> {
  const scanProvider = options.scan ?? scanUrl;
  const scanResult = await scanProvider(targetUrl);

  const loss = calculateLoss(scanResult, options.baseline);
  const backend = parseLogs(logItems);

  const frontendLossUsd = loss.estimatedMonthlyLossUsd;
  const backendWasteUsd = backend.summary.totalBackendWasteUsd;
  const combinedLossUsd = Math.round(frontendLossUsd + backendWasteUsd);

  const plan = generateRemediationPlan(loss, backend);
  const topFixId = plan.fixes.length > 0 ? plan.fixes[0].id : null;

  const performanceScore = computePerformanceScore(
    combinedLossUsd,
    options.thresholds,
  );

  return {
    id: globalThis.crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    targetUrl,
    frontendLossUsd,
    backendWasteUsd,
    combinedLossUsd,
    topFixId,
    performanceScore,
  };
}

export function syntheticScanResult(url: string): ScanResult {
  const result = emptyScanResult(url);
  result.performance = {
    ttfb: 480,
    lcp: 3100,
    totalBlockingTime: 320,
    totalPayloadBytes: 524000,
  };
  result.thirdParty = {
    scriptCount: 5,
    payloadBytes: 61000,
    domains: ['cdn.example.com', 'analytics.example.net', 'ads.example.com'],
  };
  result.securityHeaders = {
    hsts: false,
    csp: false,
    xFrameOptions: null,
    xContentTypeOptions: false,
    score: 0,
  };
  return result;
}

export function pristineScanResult(url: string): ScanResult {
  const result = emptyScanResult(url);
  result.performance = {
    ttfb: 50,
    lcp: 650,
    totalBlockingTime: 0,
    totalPayloadBytes: 46000,
  };
  result.securityHeaders = {
    hsts: true,
    csp: true,
    xFrameOptions: 'DENY',
    xContentTypeOptions: true,
    score: 100,
  };
  return result;
}