import { makeSession } from './internal';
import { SHOPIFY_READ_ONLY_SCOPES } from './providers/shopify';
import { VERCEL_READ_ONLY_SCOPES } from './providers/vercel';
import { AWS_READ_ONLY_POLICIES } from './providers/aws';
import { HUBSPOT_READ_ONLY_SCOPES } from './providers/hubspot';
import type { AuthProviderKind, ReadonlyAuthSession, ScopeValidationResult } from './types';

export interface MockAuthConfig {
  shopifyDomain?: string;
  vercelTeamId?: string;
  awsAccountId?: string;
  hubspotPortalId?: string;
}

const DEFAULT_CONFIG: Required<MockAuthConfig> = {
  shopifyDomain: 'mock-store.myshopify.com',
  vercelTeamId: 'team_mock_telemetry',
  awsAccountId: '012345678901',
  hubspotPortalId: '90000001',
};

export const MOCK_TOKENS: Record<AuthProviderKind, string> = {
  shopify: 'mock_shopify_access_token_val',
  vercel: 'mock_vercel_api_token_val',
  aws: '',
  hubspot: 'mock_hubspot_access_token_val',
};

export const MOCK_TELEMETRY_TARGETS: Record<AuthProviderKind, string> = {
  shopify: 'https://mock-store.myshopify.com/admin/api/2026-01',
  vercel: 'https://api.vercel.com/v2',
  aws: 'https://sts.amazonaws.com',
  hubspot: 'https://api.hubapi.com/crm/v3',
};

function validScopeResult(grantedScopes: string[]): ScopeValidationResult {
  return {
    valid: true,
    grantedScopes,
    readOnlyScopes: grantedScopes,
    rejectedScopes: [],
    missingReadOnlyScopes: [],
  };
}

export function buildMockSession(provider: AuthProviderKind, config?: MockAuthConfig): ReadonlyAuthSession {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  switch (provider) {
    case 'shopify': {
      const scopes = [...SHOPIFY_READ_ONLY_SCOPES];
      return makeSession({
        provider,
        accountId: cfg.shopifyDomain,
        mock: true,
        ttlMs: 86_400_000,
        scopeValidation: validScopeResult(scopes),
        readOnlyScopes: scopes,
        telemetryTarget: `https://${cfg.shopifyDomain}/admin/api/2026-01`,
        credential: {
          provider,
          kind: 'mock',
          shopDomain: cfg.shopifyDomain,
          mockToken: MOCK_TOKENS.shopify,
        },
      });
    }
    case 'vercel': {
      const scopes = [...VERCEL_READ_ONLY_SCOPES];
      return makeSession({
        provider,
        accountId: cfg.vercelTeamId,
        mock: true,
        ttlMs: 86_400_000,
        scopeValidation: validScopeResult(scopes),
        readOnlyScopes: scopes,
        telemetryTarget: MOCK_TELEMETRY_TARGETS.vercel,
        credential: {
          provider,
          kind: 'mock',
          teamId: cfg.vercelTeamId,
          mockToken: MOCK_TOKENS.vercel,
        },
      });
    }
    case 'aws': {
      const scopes = [...AWS_READ_ONLY_POLICIES];
      return makeSession({
        provider,
        accountId: cfg.awsAccountId,
        mock: true,
        ttlMs: 86_400_000,
        scopeValidation: validScopeResult(scopes),
        readOnlyScopes: scopes,
        telemetryTarget: MOCK_TELEMETRY_TARGETS.aws,
        credential: {
          provider,
          kind: 'mock',
          roleArn: `arn:aws:iam::${cfg.awsAccountId}:role/OpsPilotAuditRole`,
          policy: 'SecurityAudit',
        },
      });
    }
    case 'hubspot': {
      const scopes = [...HUBSPOT_READ_ONLY_SCOPES];
      return makeSession({
        provider,
        accountId: cfg.hubspotPortalId,
        mock: true,
        ttlMs: 86_400_000,
        scopeValidation: validScopeResult(scopes),
        readOnlyScopes: scopes,
        telemetryTarget: MOCK_TELEMETRY_TARGETS.hubspot,
        credential: {
          provider,
          kind: 'mock',
          portalId: cfg.hubspotPortalId,
          mockToken: MOCK_TOKENS.hubspot,
        },
      });
    }
  }
}

export function getAllMockSessions(config?: MockAuthConfig): ReadonlyAuthSession[] {
  const kinds: AuthProviderKind[] = ['shopify', 'vercel', 'aws', 'hubspot'];
  return kinds.map((kind) => buildMockSession(kind, config));
}

export function useMockEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.USE_MOCK_AUTH ?? '').trim().toLowerCase() === 'true';
}