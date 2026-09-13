import assert from 'node:assert/strict';
import {
  AUTH_PROVIDER_KINDS,
  validateAndCreateSession,
  createSessionFromEnv,
  validateScopesForProvider,
  validateAwsCredentials,
  buildShopifyAuthorizeUrl,
  buildHubSpotAuthorizeUrl,
  useMockEnv,
  buildMockSession,
  getAllMockSessions,
  SHOPIFY_READ_ONLY_SCOPES,
  VERCEL_READ_ONLY_SCOPES,
  AWS_READ_ONLY_POLICIES,
  HUBSPOT_READ_ONLY_SCOPES,
} from './index';

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  await check('Shopify accepts the full read-only scope set', () => {
    const result = validateScopesForProvider('shopify', [...SHOPIFY_READ_ONLY_SCOPES]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.rejectedScopes, []);
    assert.deepEqual(result.missingReadOnlyScopes, []);
  });

  await check('Shopify rejects write_* scopes', () => {
    const granted = [...SHOPIFY_READ_ONLY_SCOPES, 'write_products'];
    const result = validateScopesForProvider('shopify', granted);
    assert.equal(result.valid, false);
    assert.ok(result.rejectedScopes.includes('write_products'));
  });

  await check('Shopify flags missing read scope (read_analytics)', () => {
    const granted = ['read_orders', 'read_products', 'read_script_tags'];
    const result = validateScopesForProvider('shopify', granted);
    assert.equal(result.valid, false);
    assert.ok(result.missingReadOnlyScopes.includes('read_analytics'));
  });

  await check('Shopify creates a valid non-mock session with OAuth token', async () => {
    const session = await validateAndCreateSession('shopify', {
      shopDomain: 'demo-store.myshopify.com',
      accessToken: 'mock_shopify_access_token_val',
      scopes: [...SHOPIFY_READ_ONLY_SCOPES],
    });
    assert.equal(session.mock, false);
    assert.equal(session.readonly, true);
    assert.equal(session.accountId, 'demo-store.myshopify.com');
    assert.match(session.telemetryTarget, /^https:\/\/demo-store\.myshopify\.com\/admin\/api\//);
    assert.match(session.credential.tokenPreview!, /^mock/);
  });

  await check('Shopify OAuth authorize URL is well-formed', () => {
    const url = buildShopifyAuthorizeUrl({
      shopDomain: 'demo-store.myshopify.com',
      clientId: 'abc123',
      redirectUri: 'https://opspilot.ai/oauth/shopify',
      state: 's1',
    });
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'demo-store.myshopify.com');
    assert.equal(parsed.pathname, '/admin/oauth/authorize');
    assert.equal(parsed.searchParams.get('client_id'), 'abc123');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'https://opspilot.ai/oauth/shopify');
    assert.equal(parsed.searchParams.get('scope'), SHOPIFY_READ_ONLY_SCOPES.join(','));
  });

  await check('Vercel validates token with read-only scopes', () => {
    const result = validateScopesForProvider('vercel', [...VERCEL_READ_ONLY_SCOPES]);
    assert.equal(result.valid, true);
  });

  await check('Vercel rejects non read-only scope (deployment:write)', () => {
    const granted = [...VERCEL_READ_ONLY_SCOPES, 'deployment:write'];
    const result = validateScopesForProvider('vercel', granted);
    assert.equal(result.valid, false);
    assert.ok(result.rejectedScopes.includes('deployment:write'));
  });

  await check('Vercel creates a valid token session', async () => {
    const session = await validateAndCreateSession('vercel', {
      token: 'mock_vercel_api_token_val',
      scopes: [...VERCEL_READ_ONLY_SCOPES],
      teamId: 'team_x',
    });
    assert.equal(session.mock, false);
    assert.equal(session.accountId, 'team_x');
  });

  await check('AWS accepts SecurityAudit cross-account role ARN', () => {
    const result = validateScopesForProvider('aws', [...AWS_READ_ONLY_POLICIES]);
    assert.equal(result.valid, true);
  });

  await check('AWS rejects AdministratorAccess policy', async () => {
    const session = await validateAndCreateSession('aws', {
      accountId: '012345678901',
      roleArn: 'arn:aws:iam::012345678901:role/OpsPilotAudit',
      policy: 'arn:aws:iam::aws:policy/AdministratorAccess',
    }).catch((err) => err);
    assert.ok(session instanceof Error);
    assert.match(session.message, /Read-only scope violation/);
  });

  await check('AWS rejects malformed role ARN', () => {
    const result = validateAwsCredentials({
      accountId: '012345678901',
      roleArn: 'arn:aws:iam::123:role/OpsPilotAudit',
      policy: 'SecurityAudit',
    });
    assert.equal(result.valid, false);
    assert.match(result.reason ?? '', /Role ARN/);
  });

  await check('AWS session exposes role ARN and allowed policy', async () => {
    const session = await validateAndCreateSession('aws', {
      accountId: '012345678901',
      roleArn: 'arn:aws:iam::012345678901:role/OpsPilotAudit',
      policy: 'SecurityAudit',
    });
    assert.equal(session.mock, false);
    assert.match(session.credential.roleArn!, /OpsPilotAudit/);
    assert.equal(session.credential.policy, 'SecurityAudit');
  });

  await check('HubSpot accepts the two read-only CRM scopes', () => {
    const result = validateScopesForProvider('hubspot', [...HUBSPOT_READ_ONLY_SCOPES]);
    assert.equal(result.valid, true);
  });

  await check('HubSpot rejects crm write scope', () => {
    const granted = [...HUBSPOT_READ_ONLY_SCOPES, 'crm.objects.contacts.write'];
    const result = validateScopesForProvider('hubspot', granted);
    assert.equal(result.valid, false);
    assert.ok(result.rejectedScopes.includes('crm.objects.contacts.write'));
  });

  await check('HubSpot flags missing deals.read', () => {
    const result = validateScopesForProvider('hubspot', ['crm.objects.contacts.read']);
    assert.equal(result.valid, false);
    assert.ok(result.missingReadOnlyScopes.includes('crm.objects.deals.read'));
  });

  await check('HubSpot creates a valid token session', async () => {
    const session = await validateAndCreateSession('hubspot', {
      accessToken: 'mock_hubspot_access_token_val',
      scopes: [...HUBSPOT_READ_ONLY_SCOPES],
      portalId: '90000001',
    });
    assert.equal(session.mock, false);
    assert.equal(session.accountId, '90000001');
  });

  await check('HubSpot OAuth authorize URL is well-formed', () => {
    const url = buildHubSpotAuthorizeUrl({
      portalId: '90000001',
      clientId: 'hub-client',
      redirectUri: 'https://opspilot.ai/oauth/hubspot',
      state: 'st',
    });
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'app.hubspot.com');
    assert.equal(parsed.pathname, '/oauth/authorize');
  });

  await check('Mock sessions exist for every provider and are valid read-only', () => {
    const sessions = getAllMockSessions();
    assert.equal(sessions.length, AUTH_PROVIDER_KINDS.length);
    for (const session of sessions) {
      assert.equal(session.mock, true);
      assert.equal(session.readonly, true);
      assert.equal(session.scopeValidation.valid, true);
      assert.deepEqual(session.scopeValidation.rejectedScopes, []);
      assert.ok(session.readOnlyScopes.length > 0);
      assert.ok(session.telemetryTarget.length > 0);
      assert.ok(new Date(session.expiresAt) > new Date());
    }
  });

  await check('Mock sessions include usable mock credentials', () => {
    const shopify = buildMockSession('shopify');
    assert.match(shopify.credential.mockToken!, /^mock_shopify_access_token_val/);
    const hubspot = buildMockSession('hubspot');
    assert.match(hubspot.credential.mockToken!, /^mock_hubspot_access_token_val/);
  });

  await check('validateAndCreateSession falls back to mock with empty credentials', async () => {
    const session = await validateAndCreateSession('shopify', {});
    assert.equal(session.mock, true);
  });

  await check('validateAndCreateSession throws on invalid real credentials', async () => {
    const err = await validateAndCreateSession('shopify', {
      shopDomain: 'demo-store.myshopify.com',
      accessToken: 'mock_shopify_access_token_val',
      scopes: ['write_orders'],
    }).catch((caught) => caught);
    assert.ok(err instanceof Error);
  });

  await check('useMockEnv reads USE_MOCK_AUTH flag', () => {
    assert.equal(useMockEnv({ USE_MOCK_AUTH: 'true' } as NodeJS.ProcessEnv), true);
    assert.equal(useMockEnv({ USE_MOCK_AUTH: 'false' } as NodeJS.ProcessEnv), false);
  });

  await check('createSessionFromEnv routes missing env through mock', async () => {
    const previous = { ...process.env };
    delete process.env.SHOPIFY_SHOP_DOMAIN;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
    process.env.USE_MOCK_AUTH = 'false';
    const session = await createSessionFromEnv('shopify');
    assert.equal(session.mock, true);
    process.env = previous;
  });

  await check('Unknown provider is rejected', async () => {
    const err = await validateAndCreateSession('stripe' as unknown as 'shopify', {}).catch(
      (caught) => caught,
    );
    assert.ok(err instanceof Error);
    assert.match(err.message, /Unknown provider/);
  });

  console.log('');
  console.log(`AUTH TEST RUNNER — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected test runner failure:', err);
  process.exitCode = 1;
});