import type { ScanResult } from '../scanner/types';
import { computeLatencyPenalty } from './latency';
import { computeBloatPenalty } from './bloat';
import { computeSecurityRiskTax } from './security';
import { DEFAULT_BASELINE, type LossAnalysis, type StoreBaseline } from './types';

const toUsd = (value: number): number => Math.round(value);

export function calculateLoss(
  scanResult: ScanResult,
  baseline: StoreBaseline = DEFAULT_BASELINE,
): LossAnalysis {
  const { monthlyTraffic, aov, baselineConversionRate } = baseline;

  const latency = computeLatencyPenalty(scanResult.performance);
  const bloat = computeBloatPenalty(
    scanResult.performance.totalPayloadBytes,
    scanResult.thirdParty.scriptCount,
  );
  const securityRiskPercent = computeSecurityRiskTax(scanResult.securityHeaders.score);

  const latencyMultiplier =
    (1 - latency.lcpPenaltyPercent / 100) * (1 - latency.tbtPenaltyPercent / 100);
  const bloatMultiplier =
    (1 - bloat.payloadPenaltyPercent / 100) * (1 - bloat.thirdPartyPenaltyPercent / 100);
  const combinedMultiplier =
    latencyMultiplier * bloatMultiplier * Math.max(0, 1 - securityRiskPercent / 100);

  const potentialRevenue = monthlyTraffic * baselineConversionRate * aov;
  const effectiveConversionRate = Math.max(0, baselineConversionRate * combinedMultiplier);

  return {
    estimatedMonthlyLossUsd: toUsd(potentialRevenue * (1 - combinedMultiplier)),
    lostConversionPoints: (baselineConversionRate - effectiveConversionRate) * 100,
    effectiveConversionRate,
    breakdown: {
      latencyLossUsd: toUsd(potentialRevenue * (1 - latencyMultiplier)),
      bloatLossUsd: toUsd(potentialRevenue * (1 - bloatMultiplier)),
      securityRiskUsd: toUsd(potentialRevenue * (securityRiskPercent / 100)),
    },
    metrics: {
      lcpPenaltyPercent: latency.lcpPenaltyPercent,
      tbtPenaltyPercent: latency.tbtPenaltyPercent,
      payloadPenaltyPercent: bloat.payloadPenaltyPercent,
    },
  };
}