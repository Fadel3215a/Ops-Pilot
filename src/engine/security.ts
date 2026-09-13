export const SECURITY_LOW_THRESHOLD = 50;
export const SECURITY_MID_THRESHOLD = 75;
export const SECURITY_TAX_LOW = 2;
export const SECURITY_TAX_MID = 1;

export function computeSecurityRiskTax(securityScore: number): number {
  if (securityScore < SECURITY_LOW_THRESHOLD) return SECURITY_TAX_LOW;
  if (securityScore <= SECURITY_MID_THRESHOLD) return SECURITY_TAX_MID;
  return 0;
}