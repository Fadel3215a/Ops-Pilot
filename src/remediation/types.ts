export type FixCategory =
  | 'performance'
  | 'security'
  | 'serverless'
  | 'database'
  | 'architecture';

export type FixId =
  | 'LCP_IMAGE_PRELOAD'
  | 'SCRIPT_DEFER'
  | 'SECURITY_HEADERS'
  | 'SERVERLESS_WARMER'
  | 'WEBHOOK_DEDUPE'
  | 'DB_N1_BATCH';

export interface ActionableFix {
  id: FixId;
  title: string;
  category: FixCategory;
  targetPath: string;
  monthlySavingsUsd: number;
  estimatedEffortHours: number;
  roiScore: number;
  description: string;
  suggestedCodeDiff: string;
}

export interface RemediationPlan {
  totalMonthlySavingsUsd: number;
  totalEffortHours: number;
  fixes: ActionableFix[];
}