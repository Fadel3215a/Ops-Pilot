const LEAD_STORAGE_KEY = 'opsPilot:leadCaptured';
const MODAL_DISMISS_KEY = 'opsPilot:modalDismissed';

export class LeadCaptureModal {
  private readonly container: HTMLElement;
  private readonly onCapture: (email: string, scanUrl: string | null) => Promise<void>;
  private emailInput: HTMLInputElement | null = null;

  constructor(
    container: HTMLElement,
    onCapture: (email: string, scanUrl: string | null) => Promise<void>,
  ) {
    this.container = container;
    this.onCapture = onCapture;
  }

  private getCapturedEmail(): string | null {
    try {
      return window.localStorage.getItem(LEAD_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private canShow(): boolean {
    const dismissed = window.localStorage.getItem(MODAL_DISMISS_KEY);
    return !dismissed;
  }

  isCaptured(): boolean {
    return this.getCapturedEmail() !== null;
  }

  show(scanUrl: string | null): void {
    if (this.isCaptured()) return;
    if (!this.canShow()) return;

    this.container.innerHTML = `
      <div class="modal-backdrop" data-testid="lead-modal">
        <div class="modal">
          <button class="modal__close" type="button" data-testid="lead-close" aria-label="Close">&times;</button>
          <span class="card__kicker">STAGE 2 ACCESS</span>
          <h2 class="modal__title">Unlock 1-Click Code Fixes &amp; Deep Telemetry</h2>
          <p class="modal__body">
            Your audit measured the leak. The remediation plan is next &mdash; prioritized code
            fixes, A/B test framing, and 30-day rollout telemetry, delivered to your inbox.
            Early access is complimentary for the first cohort.
          </p>
          <form class="lead-form" data-testid="lead-form">
            <input
              class="field__input modal__input"
              type="email"
              data-testid="lead-email"
              placeholder="you@store.com"
              required
              autocomplete="email"
            />
            <button class="btn btn--primary btn--block" type="submit" data-testid="lead-submit">
              Unlock Full Report
            </button>
          </form>
          <p class="modal__fineprint">No spam. Zero payment. Opt out anytime.</p>
        </div>
      </div>
    `;

    this.emailInput = this.container.querySelector<HTMLInputElement>('[data-testid="lead-email"]');

    this.container
      .querySelector<HTMLFormElement>('[data-testid="lead-form"]')!
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = this.emailInput!.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          this.emailInput!.focus();
          return;
        }
        const submitBtn = this.container.querySelector<HTMLButtonElement>('[data-testid="lead-submit"]')!;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
        try {
          await this.onCapture(email, scanUrl);
          window.localStorage.setItem(LEAD_STORAGE_KEY, email);
          window.localStorage.setItem(MODAL_DISMISS_KEY, '1');
          this.renderSuccess();
        } catch {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Retry';
        }
      });

    this.container
      .querySelector<HTMLButtonElement>('[data-testid="lead-close"]')!
      .addEventListener('click', () => this.dismiss());

    this.container
      .querySelector<HTMLElement>('[data-testid="lead-modal"]')!
      .addEventListener('click', (event) => {
        if (event.target === event.currentTarget) this.dismiss();
      });
  }

  private renderSuccess(): void {
    this.container.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal modal--success" data-testid="lead-success">
          <span class="card__kicker">ACCESS GRANTED</span>
          <h2 class="modal__title">You're on the list.</h2>
          <p class="modal__body">
            The remediation plan is being assembled. Watch your inbox for the deep-dive audit and
            onboarding invite.
          </p>
          <button class="btn btn--ghost btn--block" type="button" data-testid="lead-done">
            Done
          </button>
        </div>
      </div>
    `;
    this.container
      .querySelector<HTMLButtonElement>('[data-testid="lead-done"]')!
      .addEventListener('click', () => this.dismiss());
  }

  private dismiss(): void {
    try {
      window.localStorage.setItem(MODAL_DISMISS_KEY, '1');
    } catch {
      null;
    }
    this.container.innerHTML = '';
  }
}