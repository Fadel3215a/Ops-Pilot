import { calculateLoss } from '../../engine';
import { getAllMockSessions, validateAndCreateSession } from '../../telemetry/auth';
import { AUTH_PROVIDER_KINDS, type AuthProviderKind, type ReadonlyAuthSession } from '../../telemetry/auth/types';
import { parseLogs, RAW_LOGS_FIXTURE } from '../../telemetry/parser';
import type { ParsedLogAnalysis } from '../../telemetry/parser/types';
import { BackendWasteCard } from './components/BackendWasteCard';
import { CombinedLossHero } from './components/CombinedLossHero';
import { SessionStatusCard } from './components/SessionStatusCard';
import { TelemetryStream } from './components/TelemetryStream';
import { backendMonthlyUsd, SYNTHETIC_SCAN } from './seed';

type AuthMode = 'mock' | 'live';

interface EnvLike {
  [key: string]: string | undefined;
}

function required<T extends Element>(query: string): T {
  const el = document.querySelector<T>(query);
  if (el === null) throw new Error(`Missing mount point: ${query}`);
  return el;
}

function readEnv(): EnvLike {
  const processLike = (globalThis as { process?: { env?: EnvLike } }).process;
  return processLike?.env ?? {};
}

function envForProvider(provider: AuthProviderKind, env: EnvLike): EnvLike {
  switch (provider) {
    case 'shopify':
      return {
        shopDomain: env.SHOPIFY_SHOP_DOMAIN,
        accessToken: env.SHOPIFY_ACCESS_TOKEN,
        scopes: env.SHOPIFY_SCOPES,
      };
    case 'vercel':
      return {
        token: env.VERCEL_TOKEN,
        scopes: env.VERCEL_SCOPES,
        teamId: env.VERCEL_TEAM_ID,
      };
    case 'aws':
      return {
        accountId: env.AWS_ACCOUNT_ID,
        roleArn: env.AWS_ROLE_ARN,
        policy: env.AWS_POLICY,
        roleSessionName: env.AWS_ROLE_SESSION_NAME,
      };
    case 'hubspot':
      return {
        accessToken: env.HUBSPOT_ACCESS_TOKEN,
        scopes: env.HUBSPOT_SCOPES,
        portalId: env.HUBSPOT_PORTAL_ID,
      };
  }
}

async function resolveSessions(mode: AuthMode): Promise<ReadonlyAuthSession[]> {
  if (mode === 'mock') return getAllMockSessions();
  const env = readEnv();
  const sessions: ReadonlyAuthSession[] = [];
  for (const provider of AUTH_PROVIDER_KINDS) {
    sessions.push(await validateAndCreateSession(provider, envForProvider(provider, env)));
  }
  return sessions;
}

interface DashboardState {
  mode: AuthMode;
  analysis: ParsedLogAnalysis;
  sessions: ReadonlyAuthSession[];
}

function main(): void {
  const loss = calculateLoss(SYNTHETIC_SCAN);
  const analysis = parseLogs(RAW_LOGS_FIXTURE);

  const hero = new CombinedLossHero(required('#hero-mount'));
  const sessionsCard = new SessionStatusCard(required('#sessions-mount'));
  const backend = new BackendWasteCard(required('#backend-mount'));
  const telemetry = new TelemetryStream(required('#telemetry-mount'));

  const state: DashboardState = {
    mode: 'mock',
    analysis,
    sessions: [],
  };

  const toggle = required<HTMLButtonElement>('#auth-toggle');
  const toggleLabel = required('#auth-mode-label');

  hero.setResult(loss, backendMonthlyUsd(analysis.summary.totalBackendWasteUsd));
  backend.setResult(analysis);
  telemetry.setLogs(analysis, RAW_LOGS_FIXTURE);
  sessionsCard.setActive('shopify');

  async function applyMode(mode: AuthMode): Promise<void> {
    state.mode = mode;
    toggle.disabled = true;
    toggle.classList.add('btn-toggle--busy');
    try {
      state.sessions = await resolveSessions(mode);
      sessionsCard.setSessions(state.sessions);
    } finally {
      toggle.disabled = false;
      toggle.classList.remove('btn-toggle--busy');
    }
    const live = state.sessions.some((session) => !session.mock);
    toggleLabel.textContent = `${mode.toUpperCase()}${live ? ' · LIVE' : ''}`;
  }

  void applyMode('mock');

  toggle.addEventListener('click', () => {
    void applyMode(state.mode === 'mock' ? 'live' : 'mock');
  });
}

main();