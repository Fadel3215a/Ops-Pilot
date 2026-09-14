import { generateExecutiveSummary, DEFAULT_MODEL } from '../../../ai';
import type {
  AIAnalysisRequest,
  ExecutiveSummary,
} from '../../../ai/types';

interface GlobalWithAiKey {
  __OPSPILOT_AI_KEY__?: string;
}

export class AiInsightsCard {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderIdle();
  }

  private renderIdle(): void {
    this.container.innerHTML = `
      <div class="panel ai-panel" data-testid="ai-card">
        <div class="panel__head">
          <span class="panel__title">AI EXECUTIVE INSIGHTS</span>
          <span class="panel__sub">
            GEMINI ${DEFAULT_MODEL.toUpperCase()} · GENERATING…
          </span>
        </div>
      </div>
    `;
  }

  async setResult(request: AIAnalysisRequest): Promise<void> {
    const globalWithKey = globalThis as GlobalWithAiKey;
    const apiKey = globalWithKey.__OPSPILOT_AI_KEY__;

    const summary = await generateExecutiveSummary(request, {
      apiKey,
      dryRun: apiKey === undefined || apiKey.trim() === '',
    });

    this.render(request, summary, apiKey !== undefined && apiKey.trim() !== '');
  }

  private render(
    request: AIAnalysisRequest,
    summary: ExecutiveSummary,
    live: boolean,
  ): void {
    const riskClass =
      summary.riskLevel === 'critical'
        ? 'risk--critical'
        : summary.riskLevel === 'warning'
          ? 'risk--warning'
          : 'risk--healthy';
    const actions = summary.actionItems
      .map(
        (item, index) => `
          <li class="ai-action" data-testid="ai-action">
            <span class="ai-action__index">${String(index + 1).padStart(2, '0')}</span>
            ${this.escapeHtml(item)}
          </li>
        `,
      )
      .join('');

    this.container.innerHTML = `
      <div class="panel ai-panel" data-testid="ai-card">
        <div class="panel__head">
          <span class="panel__title">AI EXECUTIVE INSIGHTS</span>
          <span class="panel__sub">
            GEMINI ${DEFAULT_MODEL.toUpperCase()} · ${live ? 'LIVE' : 'OFFLINE PREVIEW'}
          </span>
        </div>
        <div class="ai-grid">
          <div class="ai-risk-row">
            <span class="ai-risk ${riskClass}" data-testid="ai-risk">
              ${summary.riskLevel.toUpperCase()}
            </span>
            <span class="ai-score">
              SCORE ${request.performanceScore}/100
            </span>
          </div>
          <h2 class="ai-headline" data-testid="ai-headline">
            ${this.escapeHtml(summary.headline)}
          </h2>
          <p class="ai-takeaway" data-testid="ai-takeaway">
            ${this.escapeHtml(summary.keyTakeaway)}
          </p>
          <ul class="ai-actions">
            ${actions}
          </ul>
        </div>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}