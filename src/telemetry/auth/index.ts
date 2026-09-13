import {
  AUTH_PROVIDER_KINDS,
  isAuthProviderKind,
  type AuthProviderKind,
  type ReadonlyAuthSession,
  type ScopeValidationResult,
} from './types';
import type {
  ShopifyCredentialsInput,
} from './providers/shopify';
import {
  SHOPIFY_READ_ONLY_SCOPES,
  createShopifySession,
  validateShopifyCredentials,
} from './providers/shopify';
import {
  VERCEL_READ_ONLY_SCOPES,
  createVercelSession,
  validateVercelCredentials,
} from './providers/vercel';
import {
  AWS_READ_ONLY_POLICIES,
  createAwsSession,
  validateAwsCredentials,
} from './providers/aws';
import {
  HUBSPOT_READ_ONLY_SCOPES,
  createHubSpotSession,
  validateHubSpotCredentials,
} from './providers/hubspot';
import { buildMockSession, useMockEnv } from './mock';
import { validateScopeSet } from './internal';

export * from './types';

export {
  SHOPIFY_READ_ONLY_SCOPES,
  createShopifySession,
  validateShopifyCredentials,
  buildShopifyAuthorizeUrl,
  buildShopifyTokenExchangeUrl,
} from './providers/shopify';
export {
  VERCEL_READ_ONLY_SCOPES,
  createVercelSession,
  validateVercelCredentials,
  validateVercelToken,
} from './providers/vercel';
export {
  AWS_READ_ONLY_POLICIES,
  createAwsSession,
  validateAwsCredentials,
  parseRoleArn,
  normalizePolicy,
} from './providers/aws';
export {
  HUBSPOT_READ_ONLY_SCOPES,
  createHubSpotSession,
  validateHubSpotCredentials,
  buildHubSpotAuthorizeUrl,
} from './providers/hubspot';
export {
  buildMockSession,
  getAllMockSessions,
  useMockEnv,
  MOCK_TOKENS,
  MOCK_TELEMETRY_TARGETS,
} from './mock';

export const READ_ONLY_SCOPES_BY_PROVIDER: Record<AuthProviderKind, readonly string[]> = {
  shopify: SHOPIFY_READ_ONLY_SCOPES,
  vercel: VERCEL_READ_ONLY_SCOPES,
  aws: AWS_READ_ONLY_POLICIES,
  hubspot: HUBSPOT_READ_ONLY_SCOPES,
};

export function validateScopesForProvider(
  provider: AuthProviderKind,
  grantedScopes: string[],
): ScopeValidationResult {
  const allowed = READ_ONLY_SCOPES_BY_PROVIDER[provider];
  if (allowed === undefined) {
    throw new Error(`Unsupported provider: ${String(provider)}`);
  }
  return validateScopeSet(grantedScopes, allowed);
}

type CredentialRecord = Record<string, unknown>;

function containsCredentials(credentials: CredentialRecord | undefined): boolean {
  if (credentials === undefined || credentials === null) return false;
  return Object.values(credentials).some(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
}

export async function validateAndCreateSession(
  provider: AuthProviderKind,
  credentials?: CredentialRecord,
): Promise<ReadonlyAuthSession> {
  if (!isAuthProviderKind(provider)) {
    throw new Error(`Unknown provider: ${String(provider)}. Expected one of ${AUTH_PROVIDER_KINDS.join(', ')}`);
  }

  if (!containsCredentials(credentials) || useMockEnv()) {
    return buildMockSession(provider);
  }

  const creds = credentials as Record<string, unknown>;
  let session: ReadonlyAuthSession;
  let validation: ScopeValidationResult;

  switch (provider) {
    case 'shopify': {
      validation = validateShopifyCredentials(creds as ShopifyCredentialsInput);
      session = createShopifySession(creds as ShopifyCredentialsInput);
      break;
    }
    case 'vercel': {
      validation = validateVercelCredentials(creds as { token?: unknown; scopes?: unknown; teamId?: unknown });
      session = createVercelSession(creds);
      break;
    }
    case 'aws': {
      validation = validateAwsCredentials(creds);
      session = createAwsSession(creds);
      break;
    }
    case 'hubspot': {
      validation = validateHubSpotCredentials(creds);
      session = createHubSpotSession(creds);
      break;
    }
  }

  if (!validation.valid) {
    const detail = [
      validation.reason ?? '',
      `rejected=[${validation.rejectedScopes.join(', ')}]`,
      `missing=[${validation.missingReadOnlyScopes.join(', ')}]`,
    ].filter((part) => part !== '').join('; ');
    throw new Error(`Read-only scope violation for ${provider}: ${detail}`);
  }

  return session;
}

export async function createSessionFromEnv(provider: AuthProviderKind): Promise<ReadonlyAuthSession> {
  const env = process.env;
  const credentials: CredentialRecord = {};

  switch (provider) {
    case 'shopify':
      credentials.shopDomain = env.SHOPIFY_SHOP_DOMAIN;
      credentials.accessToken = env.SHOPIFY_ACCESS_TOKEN;
      credentials.scopes = env.SHOPIFY_SCOPES;
      break;
    case 'vercel':
      credentials.token = env.VERCEL_TOKEN;
      credentials.scopes = env.VERCEL_SCOPES;
      credentials.teamId = env.VERCEL_TEAM_ID;
      break;
    case 'aws':
      credentials.accountId = env.AWS_ACCOUNT_ID;
      credentials.roleArn = env.AWS_ROLE_ARN;
      credentials.policy = env.AWS_POLICY;
      credentials.roleSessionName = env.AWS_ROLE_SESSION_NAME;
      break;
    case 'hubspot':
      credentials.accessToken = env.HUBSPOT_ACCESS_TOKEN;
      credentials.scopes = env.HUBSPOT_SCOPES;
      credentials.portalId = env.HUBSPOT_PORTAL_ID;
      break;
  }

  return validateAndCreateSession(provider, credentials);
}