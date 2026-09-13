import type { StoreBaseline } from '../../engine/types';
import { DEFAULT_BASELINE } from '../../engine/types';

export interface AuditFormCallbacks {
  onScan: (url: string) => void;
  onBaselineChange: (baseline: StoreBaseline) => void;
}

export class AuditForm {
  private readonly container: HTMLElement;
  private readonly callbacks: AuditFormCallbacks;
  private readonly urlInput: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly trafficSlider: HTMLInputElement;
  private readonly aovSlider: HTMLInputElement;
  private readonly trafficValue: HTMLElement;
  private readonly aovValue: HTMLElement;
  private baseline: StoreBaseline = { ...DEFAULT_BASELINE };

  constructor(container: HTMLElement, callbacks: AuditFormCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    container.innerHTML = `
      <form class="audit-form" data-testid="audit-form">
        <label class="field">
          <span class="field__label">STORE URL</span>
          <div class="field__row">
            <input
              class="field__input"
              type="url"
              data-testid="url-input"
              placeholder="https://your-store.com"
              autocomplete="off"
              spellcheck="false"
              required
            />
            <button class="btn btn--primary" type="submit" data-testid="run-audit">
              Run Audit
            </button>
          </div>
        </label>

        <div class="audit-form__baseline">
          <div class="audit-form__baseline-head">
            <span class="field__label">BASELINE CONTROLS</span>
            <button class="btn btn--ghost btn--sm" type="button" data-testid="reset-baseline">
              Reset preset
            </button>
          </div>
          <div class="audit-form__sliders">
            <label class="slider">
              <span class="slider__row">
                <span>Monthly traffic</span>
                <output class="slider__value" data-testid="traffic-value"
                  >${this.baseline.monthlyTraffic.toLocaleString('en-US')}</output
                >
              </span>
              <input
                class="slider__input"
                type="range"
                data-testid="traffic-slider"
                min="1000"
                max="500000"
                step="5000"
                value="${this.baseline.monthlyTraffic}"
              />
            </label>
            <label class="slider">
              <span class="slider__row">
                <span>Average order value</span>
                <output class="slider__value" data-testid="aov-value">$${this.baseline.aov}</output>
              </span>
              <input
                class="slider__input"
                type="range"
                data-testid="aov-slider"
                min="10"
                max="300"
                step="5"
                value="${this.baseline.aov}"
              />
            </label>
            <div class="slider slider--static">
              <span class="slider__row">
                <span>Baseline conversion rate</span>
                <output class="slider__value" data-testid="cr-value">2.5%</output>
              </span>
              <div class="cr-bar"><span class="cr-bar__fill" style="width: 2.5%"></span></div>
            </div>
          </div>
        </div>
      </form>
    `;

    this.urlInput = container.querySelector<HTMLInputElement>('[data-testid="url-input"]')!;
    this.submitButton = container.querySelector<HTMLButtonElement>('[data-testid="run-audit"]')!;
    this.trafficSlider = container.querySelector<HTMLInputElement>('[data-testid="traffic-slider"]')!;
    this.aovSlider = container.querySelector<HTMLInputElement>('[data-testid="aov-slider"]')!;
    this.trafficValue = container.querySelector<HTMLElement>('[data-testid="traffic-value"]')!;
    this.aovValue = container.querySelector<HTMLElement>('[data-testid="aov-value"]')!;

    const form = container.querySelector<HTMLFormElement>('[data-testid="audit-form"]')!;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });

    this.trafficSlider.addEventListener('input', () => this.applyBaseline());
    this.aovSlider.addEventListener('input', () => this.applyBaseline());

    container.querySelector<HTMLButtonElement>('[data-testid="reset-baseline"]')!.addEventListener('click', () => {
      this.trafficSlider.value = String(DEFAULT_BASELINE.monthlyTraffic);
      this.aovSlider.value = String(DEFAULT_BASELINE.aov);
      this.applyBaseline();
    });
  }

  private applyBaseline(): void {
    this.baseline = {
      monthlyTraffic: Number(this.trafficSlider.value),
      aov: Number(this.aovSlider.value),
      baselineConversionRate: DEFAULT_BASELINE.baselineConversionRate,
    };
    this.trafficValue.textContent = this.baseline.monthlyTraffic.toLocaleString('en-US');
    this.aovValue.textContent = `$${this.baseline.aov}`;
    this.callbacks.onBaselineChange(this.baseline);
  }

  private submit(): void {
    const raw = this.urlInput.value.trim();
    if (raw === '') {
      this.urlInput.focus();
      return;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    this.callbacks.onScan(normalized);
  }

  setLoading(loading: boolean): void {
    this.submitButton.disabled = loading;
    this.submitButton.textContent = loading ? 'Scanning…' : 'Run Audit';
  }

  getBaseline(): StoreBaseline {
    return { ...this.baseline };
  }
}