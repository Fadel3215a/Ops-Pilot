import { randomUUID } from 'node:crypto';
import {
  coerceScopeList,
  encodeScopes,
  makeSession,
  redactToken,
  validateScopeSet,
} from '../internal';
import type { ReadonlyAuthSession, ScopeValidationResult } from '../types';

export const HUBSPOT_READ_ONLY_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.deals.read',
] as const;

export interface HubSpotCredentialsInput {
  accessToken?: unknown;
  scopes?: unknown;
  portalId?: unknown;
}

export function validateHubSpotCredentials(
  credentials: HubSpotCredentialsInput,
): ScopeValidationResult {
  const accessToken =
    typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
  const declared = coerceScopeList(credentials.scopes);
  const granted = declared.length > 0 ? declared : [...HUBSPOT_READ_ONLY_SCOPES];
  const setResult = validateScopeSet(granted, HUBSPOT_READ_ONLY_SCOPES);
  const reasons: string[] = [];

  if (accessToken.length < 20) {
    reasons.push('HubSpot access token missing or too short');
  }

  return {
    ...setResult,
    valid: setResult.valid && reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

export function buildHubSpotAuthorizeUrl(options: {
  portalId: string;
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  state?: string;
}): string {
  const query = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: encodeScopes(options.scopes ?? HUBSPOT_READ_ONLY_SCOPES),
    state: options.state ?? randomUUID(),
  });
  return `https://app.hubspot.com/oauth/authorize?${query.toString()}`;
}

export function createHubSpotSession(credentials: HubSpotCredentialsInput): ReadonlyAuthSession {
  const scopeValidation = validateHubSpotCredentials(credentials);
  const accessToken =
    typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
  const portalId = typeof credentials.portalId === 'string' ? credentials.portalId.trim() : '';

  return makeSession({
    provider: 'hubspot',
    accountId: portalId !== '' ? portalId : 'unassigned-portal',
    mock: false,
    ttlMs: 3_600_000,
    scopeValidation,
    readOnlyScopes: scopeValidation.readOnlyScopes,
    telemetryTarget: 'https://api.hubapi.com/crm/v3',
    credential: {
      provider: 'hubspot',
      kind: 'oauth',
      portalId: portalId !== '' ? portalId : undefined,
      tokenPreview: redactToken(accessToken),
    },
  });
}