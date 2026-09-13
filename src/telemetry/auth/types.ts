export type AuthProviderKind = 'shopify' | 'vercel' | 'aws' | 'hubspot';

export const AUTH_PROVIDER_KINDS: readonly AuthProviderKind[] = [
  'shopify',
  'vercel',
  'aws',
  'hubspot',
];

export function isAuthProviderKind(value: unknown): value is AuthProviderKind {
  return typeof value === 'string' && (AUTH_PROVIDER_KINDS as readonly string[]).includes(value);
}

export interface ScopeValidationResult {
  valid: boolean;
  grantedScopes: string[];
  readOnlyScopes: string[];
  rejectedScopes: string[];
  missingReadOnlyScopes: string[];
  reason?: string;
}

export type CredentialKind = 'oauth' | 'api-token' | 'iam-role' | 'mock';

export interface CredentialSummary {
  provider: AuthProviderKind;
  kind: CredentialKind;
  tokenPreview?: string;
  mockToken?: string;
  shopDomain?: string;
  teamId?: string;
  roleArn?: string;
  policy?: string;
  portalId?: string;
}

export interface ReadonlyAuthSession {
  provider: AuthProviderKind;
  id: string;
  readonly: true;
  mock: boolean;
  issuedAt: string;
  expiresAt: string;
  accountId: string;
  readOnlyScopes: string[];
  scopeValidation: ScopeValidationResult;
  telemetryTarget: string;
  credential: CredentialSummary;
}