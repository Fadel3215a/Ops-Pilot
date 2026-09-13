import { makeSession } from '../internal';
import type { ReadonlyAuthSession, ScopeValidationResult } from '../types';

export const AWS_READ_ONLY_POLICIES = ['SecurityAudit', 'ReadOnlyAccess'] as const;

export interface AwsCredentialsInput {
  accountId?: unknown;
  roleArn?: unknown;
  policy?: unknown;
  roleSessionName?: unknown;
}

const ROLE_ARN_RE =
  /^arn:aws:iam::(?<account>\d{12}):role\/[\w+=,.@-]{1,64}$/;
const ACCOUNT_ID_RE = /^\d{12}$/;

export function parseRoleArn(roleArn: string): { accountId: string; roleName: string } | null {
  const match = ROLE_ARN_RE.exec(roleArn);
  if (match === null) return null;
  return { accountId: match.groups!.account, roleName: roleArn.split('/').at(-1)! };
}

export function normalizePolicy(policy: unknown): string | null {
  if (typeof policy !== 'string') return null;
  const trimmed = policy.trim();
  for (const allowed of AWS_READ_ONLY_POLICIES) {
    if (trimmed === allowed || trimmed === `arn:aws:iam::aws:policy/${allowed}`) {
      return allowed;
    }
  }
  return null;
}

export function validateAwsCredentials(credentials: AwsCredentialsInput): ScopeValidationResult {
  const roleArn = typeof credentials.roleArn === 'string' ? credentials.roleArn.trim() : '';
  const parsed = parseRoleArn(roleArn);
  const accountId = typeof credentials.accountId === 'string' ? credentials.accountId.trim() : '';
  const policy = normalizePolicy(credentials.policy);
  const roleSessionName =
    typeof credentials.roleSessionName === 'string' ? credentials.roleSessionName.trim() : '';
  const validSessionName =
    roleSessionName === '' || /^[a-zA-Z0-9+=,.@-]{1,64}$/.test(roleSessionName);

  const reasons: string[] = [];

  if (parsed === null) {
    reasons.push('Role ARN must match arn:aws:iam::<12-digit-account>:role/<name>');
  } else {
    if (accountId !== '' && accountId !== parsed.accountId) {
      reasons.push('Role ARN account and provided accountId do not match');
    }
    if (accountId !== '' && !ACCOUNT_ID_RE.test(accountId)) {
      reasons.push('accountId must be a 12-digit AWS account id');
    }
  }

  if (!validSessionName) {
    reasons.push('roleSessionName may only contain letters, numbers and +=,.@- (max 64)');
  }

  if (policy === null) {
    reasons.push(`Policy must be one of: ${AWS_READ_ONLY_POLICIES.join(', ')}`);
  }

  const grantedScopes = policy === null ? [] : [policy];
  const readOnlyScopes = grantedScopes.filter((scope) =>
    (AWS_READ_ONLY_POLICIES as readonly string[]).includes(scope),
  );
  const rejectedScopes = grantedScopes.filter(
    (scope) => !(AWS_READ_ONLY_POLICIES as readonly string[]).includes(scope),
  );

  return {
    valid: rejectedScopes.length === 0 && reasons.length === 0,
    grantedScopes,
    readOnlyScopes,
    rejectedScopes,
    missingReadOnlyScopes: [],
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

export function createAwsSession(credentials: AwsCredentialsInput): ReadonlyAuthSession {
  const scopeValidation = validateAwsCredentials(credentials);
  const roleArn = typeof credentials.roleArn === 'string' ? credentials.roleArn.trim() : '';
  const parsed = parseRoleArn(roleArn);
  const policy = normalizePolicy(credentials.policy);

  return makeSession({
    provider: 'aws',
    accountId: parsed?.accountId ?? '',
    mock: false,
    ttlMs: 3_600_000,
    scopeValidation,
    readOnlyScopes: scopeValidation.readOnlyScopes,
    telemetryTarget: 'https://sts.amazonaws.com',
    credential: {
      provider: 'aws',
      kind: 'iam-role',
      roleArn: roleArn !== '' ? roleArn : undefined,
      policy: policy ?? undefined,
    },
  });
}