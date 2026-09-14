export type RiskLevel = 'critical' | 'warning' | 'healthy';

export interface AIAnalysisTopFix {
  id: string;
  name: string;
  monthlySavingsUsd: number;
}

export interface AIAnalysisRequest {
  targetUrl: string;
  combinedLossUsd: number;
  performanceScore: number;
  topFixes: AIAnalysisTopFix[];
}

export interface ExecutiveSummary {
  headline: string;
  keyTakeaway: string;
  riskLevel: RiskLevel;
  actionItems: string[];
}

export interface AIAnalysisResponse {
  summary: ExecutiveSummary;
  model: string;
  source: 'gemini' | 'fallback';
}