import type { ScanPerformance } from '../scanner/types';

export const LCP_BASELINE_MS = 1500;
export const TBT_BASELINE_MS = 200;
export const LCP_PENALTY_PER_100MS = 0.6;
export const TBT_PENALTY_PER_100MS = 0.4;

export interface LatencyPenalty {
  lcpPenaltyPercent: number;
  tbtPenaltyPercent: number;
  totalPenaltyPercent: number;
}

export function computeLatencyPenalty(performance: ScanPerformance): LatencyPenalty {
  const lcpExcessMs = Math.max(0, performance.lcp - LCP_BASELINE_MS);
  const tbtExcessMs = Math.max(0, performance.totalBlockingTime - TBT_BASELINE_MS);
  const lcpPenaltyPercent = (lcpExcessMs / 100) * LCP_PENALTY_PER_100MS;
  const tbtPenaltyPercent = (tbtExcessMs / 100) * TBT_PENALTY_PER_100MS;
  return {
    lcpPenaltyPercent,
    tbtPenaltyPercent,
    totalPenaltyPercent: lcpPenaltyPercent + tbtPenaltyPercent,
  };
}