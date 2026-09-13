export interface ScanPerformance {
  ttfb: number;
  lcp: number;
  totalBlockingTime: number;
  totalPayloadBytes: number;
}

export interface ScanDom {
  totalNodes: number;
  maxDepth: number;
  scriptTagCount: number;
  inlineScriptCount: number;
  externalScriptCount: number;
}

export interface ScanThirdParty {
  scriptCount: number;
  payloadBytes: number;
  domains: string[];
}

export interface ScanSecurityHeaders {
  hsts: boolean;
  csp: boolean;
  xFrameOptions: string | null;
  xContentTypeOptions: boolean;
  score: number;
}

export interface ScanPayloadBreakdown {
  javascript: number;
  css: number;
  image: number;
  font: number;
}

export interface ScanResult {
  url: string;
  timestamp: string;
  performance: ScanPerformance;
  dom: ScanDom;
  thirdParty: ScanThirdParty;
  securityHeaders: ScanSecurityHeaders;
  payloadBytesByType: ScanPayloadBreakdown;
  error: string | null;
}