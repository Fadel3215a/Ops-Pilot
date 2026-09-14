import type { AuthProviderKind, ReadonlyAuthSession } from '../../../telemetry/auth/types';

const PROVIDER_LABELS: Record<AuthProviderKind, string> = {
  shopify: 'SHOPIFY',
  vercel: 'VERCEL',
  aws: 'AWS',
  hubspot: 'HUBSPOT',
};

export class SessionStatusCard {
  private readonly container: HTMLElement;
  private sessions: ReadonlyAuthSession[] = [];
  private activeProvider: AuthProviderKind = 'shopify';

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderConnectionLine();
  }

  setActive(provider: AuthProviderKind): void {
    this.activeProvider = provider;
    this.render();
  }

  setSessions(sessions: ReadonlyAuthSession[]): void {
    this.sessions = sessions;
    this.render();
  }

  private renderConnectionLine(): void {
    const healthy = this.sessions.filter(
      (session) => session.scopeValidation.valid && session.scopeValidation.missingReadOnlyScopes.length === 0,
    ).length;
    const severity = healthy === 4 ? 'ok' : healthy === 0 ? 'bad' : 'warn';
    this.container.innerHTML = `
      <div class="panel sessions-panel" data-testid="session-panel">
        <div class="panel__head">
          <span class="panel__title">READ-ONLY CLOUD SESSIONS</span>
          <span class="status-line status-line--${severity}" data-testid="session-status-line">
            ${healthy}/4 HEALTHY
          </span>
        </div>
        <div class="sessions-grid">
          ${this.sessions.map((session) => this.renderBadge(session)).join('')}
        </div>
      </div>
    `;
  }

  private renderBadge(session: ReadonlyAuthSession): string {
    const label = PROVIDER_LABELS[session.provider];
    const active = session.provider === this.activeProvider;
    const granted = session.scopeValidation.grantedScopes.length;
    const missing = session.scopeValidation.missingReadOnlyScopes.length;
    const scopeState = missing === 0 ? 'clean' : 'degraded';
    return `
      <div class="session-badge session-badge--${active ? 'active' : 'idle'}" data-testid="session-card-${session.provider}">
        <div class="session-badge__row">
          <span class="session-badge__name">${label}</span>
          <span class="session-badge__sub">${session.accountId}</span>
        </div>
        <div class="session-badge__scopes">
          <span class="scope-pill scope-pill--${scopeState}">
            ${granted} SCOPE${granted === 1 ? '' : 'S'}${missing > 0 ? ` / ${missing} MISSING` : ''}
          </span>
        </div>
        <div class="session-badge__foot">
          <span class="ro-pill" data-testid="ro-status-${session.provider}">READ-ONLY</span>
          <span class="mode-pill mode-pill--${session.mock ? 'mock' : 'live'}">
            ${session.mock ? 'MOCK' : 'LIVE'}
          </span>
        </div>
      </div>
    `;
  }

  private render(): void {
    this.renderConnectionLine();
  }

  getSession(provider: AuthProviderKind): ReadonlyAuthSession | undefined {
    return this.sessions.find((session) => session.provider === provider);
  }
}