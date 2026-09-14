import type { ActionableFix } from './types';

export function computeRoiScore(
  monthlySavingsUsd: number,
  estimatedEffortHours: number,
): number {
  if (estimatedEffortHours <= 0) return 0;
  return Math.round((monthlySavingsUsd / estimatedEffortHours) * 10) / 10;
}

export function sortFixesByRoi(fixes: ActionableFix[]): ActionableFix[] {
  return [...fixes].sort((a, b) => b.roiScore - a.roiScore);
}