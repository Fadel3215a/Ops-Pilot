import type { ScanSecurityHeaders } from './types';

const HEADER_NAMES = {
  hsts: 'strict-transport-security',
  csp: 'content-security-policy',
  xFrameOptions: 'x-frame-options',
  xContentTypeOptions: 'x-content-type-options',
} as const;

export function analyzeSecurityHeaders(headers: Record<string, string>): ScanSecurityHeaders {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase()] = value;
  }

  const hstsRaw = lower[HEADER_NAMES.hsts];
  const cspRaw = lower[HEADER_NAMES.csp];
  const xfoRaw = lower[HEADER_NAMES.xFrameOptions];
  const xctoRaw = lower[HEADER_NAMES.xContentTypeOptions];

  const hsts = typeof hstsRaw === 'string' && hstsRaw.includes('max-age=');
  const csp = typeof cspRaw === 'string' && cspRaw.trim().length > 0;
  const xFrameOptions = typeof xfoRaw === 'string' ? xfoRaw.trim() : null;
  const xContentTypeOptions = typeof xctoRaw === 'string' && xctoRaw.toLowerCase() === 'nosniff';

  let score = 0;
  if (hsts) score += 25;
  if (csp) score += 25;
  if (xFrameOptions !== null) score += 25;
  if (xContentTypeOptions) score += 25;

  return { hsts, csp, xFrameOptions, xContentTypeOptions, score };
}