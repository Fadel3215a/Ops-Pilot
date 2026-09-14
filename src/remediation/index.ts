import type { LossAnalysis } from '../engine/types';
import type { ParsedLogAnalysis } from '../telemetry/parser/types';
import { generateBackendFixes } from './backendFixes';
import { generateFrontendFixes } from './frontendFixes';
import { sortFixesByRoi } from './planner';
import type { ActionableFix, RemediationPlan } from './types';

export * from './backendFixes';
export * from './frontendFixes';
export * from './planner';
export * from './types';

export function generateRemediationPlan(
  loss: LossAnalysis,
  backend: ParsedLogAnalysis,
): RemediationPlan {
  const generated = [
    ...generateFrontendFixes(loss),
    ...generateBackendFixes(backend),
  ];
  const fixes: ActionableFix[] = sortFixesByRoi(generated);

  const totalMonthlySavingsUsd = fixes.reduce(
    (sum, fix) => sum + fix.monthlySavingsUsd,
    0,
  );
  const totalEffortHours = fixes.reduce(
    (sum, fix) => sum + fix.estimatedEffortHours,
    0,
  );

  return {
    totalMonthlySavingsUsd,
    totalEffortHours,
    fixes,
  };
}