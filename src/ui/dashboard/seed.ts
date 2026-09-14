import type { ScanResult } from '../../scanner/types';

export const BACKEND_MONTHLY_MULTIPLIER = 20_000;

export const SYNTHETIC_SCAN: ScanResult = {
  url: 'https://www.demoblaze.com/',
  timestamp: '2026-09-14T10:00:00.000Z',
  performance: {
    ttfb: 3101,
    lcp: 3548,
    totalBlockingTime: 0,
    totalPayloadBytes: 692165,
  },
  dom: {
    totalNodes: 375,
    maxDepth: 16,
    scriptTagCount: 6,
    inlineScriptCount: 0,
    externalScriptCount: 6,
  },
  thirdParty: {
    scriptCount: 6,
    payloadBytes: 692165,
    domains: ['code.jquery.com', 'www.gstatic.com'],
  },
  securityHeaders: {
    hsts: false,
    csp: false,
    xFrameOptions: null,
    xContentTypeOptions: false,
    score: 0,
  },
  payloadBytesByType: {
    javascript: 610000,
    css: 48000,
    image: 25000,
    font: 0,
  },
  error: null,
};

export function backendMonthlyUsd(batchWasteUsd: number): number {
  return Math.round(batchWasteUsd * BACKEND_MONTHLY_MULTIPLIER * 100) / 100;
}

export function performanceScoreFrom(
  combinedLossUsd: number,
  ceilingUsd = 20_000,
): number {
  const ratio = Math.min(1, Math.max(0, combinedLossUsd / Math.max(1, ceilingUsd)));
  return Math.round((1 - ratio) * 100);
}