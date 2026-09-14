import {
  coerceScopeList,
  encodeScopes,
  makeSession,
  redactToken,
  validateScopeSet,
} from '../internal';
import type { ReadonlyAuthSession, ScopeValidationResult } from '../types';

export const SHOPIFY_READ_ONLY_SCOPES = [
  'read_orders',
  'read_products',
  'read_analytics',
  'read_script_tags',
] as const;

export const SHOPIFY_API_VERSION = '2026-01';

export interface ShopifyCredentialsInput {
  shopDomain?: unknown;
  accessToken?: unknown;
  scopes?: unknown;
}

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z0-9.-]+$/;

export function validateShopifyCredentials(
  credentials: ShopifyCredentialsInput,
): ScopeValidationResult {
  const shopDomain = typeof credentials.shopDomain === 'string' ? credentials.shopDomain.trim() : '';
  const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';
  const granted = coerceScopeList(credentials.scopes);

  const setResult = validateScopeSet(granted, SHOPIFY_READ_ONLY_SCOPES);
  const writes = granted.filter((scope) => /^write_/i.test(scope));
  const reasons: string[] = [];

  if (!SHOP_DOMAIN_RE.test(shopDomain)) {
    reasons.push('Invalid or missing Shopify shop domain');
  }
  if (accessToken.length < 20) {
    reasons.push('Access token missing or too short');
  }
  if (writes.length > 0) {
    reasons.push(`Write scopes detected: ${writes.join(', ')}`);
  }

  return {
    ...setResult,
    valid: setResult.valid && reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

export function buildShopifyAuthorizeUrl(options: {
  shopDomain: string;
  clientId: string;
  redirectUri: string;
  scopes?: readonly string[];
  state?: string;
}): string {
  const query = new URLSearchParams({
    client_id: options.clientId,
    scope: encodeScopes(options.scopes ?? SHOPIFY_READ_ONLY_SCOPES),
    redirect_uri: options.redirectUri,
    state: options.state ?? crypto.randomUUID(),
  });
  return `https://${options.shopDomain}/admin/oauth/authorize?${query.toString()}`;
}

export function buildShopifyTokenExchangeUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/oauth/access_token`;
}

export function createShopifySession(credentials: ShopifyCredentialsInput): ReadonlyAuthSession {
  const scopeValidation = validateShopifyCredentials(credentials);
  const shopDomain =
    typeof credentials.shopDomain === 'string' ? credentials.shopDomain.trim() : '';
  const accessToken =
    typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : '';

  return makeSession({
    provider: 'shopify',
    accountId: shopDomain,
    mock: false,
    ttlMs: 3_600_000,
    scopeValidation,
    readOnlyScopes: scopeValidation.readOnlyScopes,
    telemetryTarget: `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`,
    credential: {
      provider: 'shopify',
      kind: 'oauth',
      shopDomain,
      tokenPreview: redactToken(accessToken),
    },
  });
}