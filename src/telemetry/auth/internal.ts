import { randomUUID } from 'node:crypto';
import type {
  AuthProviderKind,
  CredentialSummary,
  ReadonlyAuthSession,
  ScopeValidationResult,
} from './types';

export function coerceScopeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  return [];
}

export function encodeScopes(scopes: readonly string[]): string {
  return scopes.join(',');
}

export function redactToken(token: string): string {
  if (token.length <= 10) return 'redacted';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function validateScopeSet(
  grantedRaw: string[],
  allowed: readonly string[],
): Omit<ScopeValidationResult, 'reason'> {
  const granted = [...new Set(grantedRaw.map((scope) => scope.trim()).filter((scope) => scope !== ''))];
  const allowedSet = new Set(allowed);
  const readOnlyScopes = granted.filter((scope) => allowedSet.has(scope));
  const rejectedScopes = granted.filter((scope) => !allowedSet.has(scope));
  const missingReadOnlyScopes = allowed.filter((scope) => !readOnlyScopes.includes(scope));
  return {
    valid: rejectedScopes.length === 0 && missingReadOnlyScopes.length === 0,
    grantedScopes: granted,
    readOnlyScopes,
    rejectedScopes,
    missingReadOnlyScopes,
  };
}

export interface SessionParts {
  provider: AuthProviderKind;
  accountId: string;
  telemetryTarget: string;
  credential: CredentialSummary;
  readOnlyScopes: string[];
  scopeValidation: ScopeValidationResult;
  mock: boolean;
  ttlMs: number;
}

export function makeSession(parts: SessionParts): ReadonlyAuthSession {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + parts.ttlMs);
  return {
    provider: parts.provider,
    id: `ro-${parts.provider}-${randomUUID().slice(0, 8)}`,
    readonly: true,
    mock: parts.mock,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    accountId: parts.accountId,
    readOnlyScopes: parts.readOnlyScopes,
    scopeValidation: parts.scopeValidation,
    telemetryTarget: parts.telemetryTarget,
    credential: parts.credential,
  };
}