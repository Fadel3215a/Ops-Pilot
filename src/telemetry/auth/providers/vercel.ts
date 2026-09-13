import {
  coerceScopeList,
  makeSession,
  redactToken,
  validateScopeSet,
} from '../internal';
import type { ReadonlyAuthSession, ScopeValidationResult } from '../types';

export const VERCEL_READ_ONLY_SCOPES = [
  'user:read',
  'team:read',
  'deployment:read',
] as const;

export interface VercelCredentialsInput {
  token?: unknown;
  scopes?: unknown;
  teamId?: unknown;
}

const VERCEL_TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

export function validateVercelToken(token: string): boolean {
  return VERCEL_TOKEN_RE.test(token);
}

export function validateVercelCredentials(
  credentials: VercelCredentialsInput,
): ScopeValidationResult {
  const token = typeof credentials.token === 'string' ? credentials.token.trim() : '';
  const declared = coerceScopeList(credentials.scopes);
  const granted = declared.length > 0 ? declared : [...VERCEL_READ_ONLY_SCOPES];
  const setResult = validateScopeSet(granted, VERCEL_READ_ONLY_SCOPES);
  const reasons: string[] = [];

  if (!validateVercelToken(token)) {
    reasons.push('Vercel access token missing or malformed');
  }

  return {
    ...setResult,
    valid: setResult.valid && reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

export function createVercelSession(credentials: VercelCredentialsInput): ReadonlyAuthSession {
  const scopeValidation = validateVercelCredentials(credentials);
  const token = typeof credentials.token === 'string' ? credentials.token.trim() : '';
  const teamId = typeof credentials.teamId === 'string' ? credentials.teamId.trim() : '';

  return makeSession({
    provider: 'vercel',
    accountId: teamId !== '' ? teamId : 'personal',
    mock: false,
    ttlMs: 86_400_000,
    scopeValidation,
    readOnlyScopes: scopeValidation.readOnlyScopes,
    telemetryTarget: 'https://api.vercel.com/v2',
    credential: {
      provider: 'vercel',
      kind: 'api-token',
      teamId: teamId !== '' ? teamId : undefined,
      tokenPreview: redactToken(token),
    },
  });
}