import type { LossAnalysis } from '../../engine/types';

export class LossBanner {
  private readonly container: HTMLElement;
  private state: 'idle' | 'loading' | 'error' | 'result' = 'idle';

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderIdle();
  }

  private renderIdle(): void {
    this.state = 'idle';
    this.container.innerHTML = '';
  }

  setLoading(): void {
    this.state = 'loading';
    this.container.innerHTML = `
      <div class="loss-banner loss-banner--loading" data-testid="loss-banner">
        <span class="spinner"></span>
        <span class="loss-banner__msg">Running headless audit…</span>
      </div>
    `;
  }

  setError(message: string): void {
    this.state = 'error';
    this.container.innerHTML = `
      <div class="loss-banner loss-banner--error" data-testid="loss-banner">
        <span class="loss-banner__label">AUDIT FAILURE</span>
        <span class="loss-banner__msg">${this.escapeHtml(message)}</span>
      </div>
    `;
  }

  setResult(loss: LossAnalysis): void {
    this.state = 'result';
    const lossStr = `$${loss.estimatedMonthlyLossUsd.toLocaleString('en-US')}`;
    const pointsStr = loss.lostConversionPoints.toFixed(3);
    const crStr = (loss.effectiveConversionRate * 100).toFixed(2) + '%';
    this.container.innerHTML = `
      <div class="loss-banner loss-banner--result" data-testid="loss-banner-result">
        <div class="loss-banner__headline">
          <span class="loss-banner__amount" data-testid="loss-amount">${lossStr}</span>
          <span class="loss-banner__unit">/ mo</span>
        </div>
        <span class="loss-banner__label">REVENUE LEAKAGE DETECTED</span>
        <span class="loss-banner__sub">
          Conversion points lost: <strong>${pointsStr}</strong> &mdash;
          Effective rate: <strong>${crStr}</strong>
        </span>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  getState(): string {
    return this.state;
  }
}