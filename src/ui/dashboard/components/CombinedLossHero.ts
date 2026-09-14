import type { LossAnalysis } from '../../../engine/types';

export class CombinedLossHero {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderIdle();
  }

  private renderIdle(): void {
    this.container.innerHTML = `
      <div class="hero-panel" data-testid="combined-loss-hero">
        <div class="hero-panel__head">
          <span class="hero-panel__kicker">COMBINED OPERATIONAL LEAKAGE</span>
          <span class="hero-panel__tag">FRONT-END + BACK-END // /MO</span>
        </div>
        <div class="hero-panel__amount" data-testid="combined-loss-total">$—</div>
        <div class="hero-panel__msg">Waiting for telemetry…</div>
      </div>
    `;
  }

  setResult(loss: LossAnalysis, backendMonthlyUsd: number): void {
    const total = Math.round(loss.estimatedMonthlyLossUsd + backendMonthlyUsd);
    const frontend = `$${loss.estimatedMonthlyLossUsd.toLocaleString('en-US')}`;
    const backend = `$${backendMonthlyUsd.toFixed(2)}`;
    this.container.innerHTML = `
      <div class="hero-panel" data-testid="combined-loss-hero">
        <div class="hero-panel__head">
          <span class="hero-panel__kicker">COMBINED OPERATIONAL LEAKAGE</span>
          <span class="hero-panel__tag">ESTIMATED / MO</span>
        </div>
        <div class="hero-panel__amount" data-testid="combined-loss-total">${total.toLocaleString('en-US')}</div>
        <div class="hero-panel__split">
          <div class="hero-chip" data-testid="frontend-loss">
            <span class="hero-chip__label">FRONT-END LEAK</span>
            <span class="hero-chip__value">${frontend}</span>
            <span class="hero-chip__note">storefront drag</span>
          </div>
          <div class="hero-chip" data-testid="backend-loss">
            <span class="hero-chip__label">BACK-END WASTE</span>
            <span class="hero-chip__value">${backend}</span>
            <span class="hero-chip__note">cold + sync + db</span>
          </div>
        </div>
        <div class="hero-panel__foot">
          <span>Conversion points lost: <strong>${loss.lostConversionPoints.toFixed(3)}</strong></span>
          <span>Effective rate: <strong>${(loss.effectiveConversionRate * 100).toFixed(2)}%</strong></span>
        </div>
      </div>
    `;
  }
}