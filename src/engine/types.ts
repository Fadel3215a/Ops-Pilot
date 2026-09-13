export interface StoreBaseline {
  monthlyTraffic: number;
  aov: number;
  baselineConversionRate: number;
}

export interface LossBreakdown {
  latencyLossUsd: number;
  bloatLossUsd: number;
  securityRiskUsd: number;
}

export interface LossMetrics {
  lcpPenaltyPercent: number;
  tbtPenaltyPercent: number;
  payloadPenaltyPercent: number;
}

export interface LossAnalysis {
  estimatedMonthlyLossUsd: number;
  lostConversionPoints: number;
  effectiveConversionRate: number;
  breakdown: LossBreakdown;
  metrics: LossMetrics;
}

export const DEFAULT_BASELINE: StoreBaseline = {
  monthlyTraffic: 50000,
  aov: 85,
  baselineConversionRate: 0.025,
};