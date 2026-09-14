import type { ParsedLogAnalysis, RawLogItem } from '../../../telemetry/parser/types';

export class TelemetryStream {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderIdle();
  }

  private renderIdle(): void {
    this.container.innerHTML = `
      <div class="panel telemetry-panel" data-testid="telemetry-stream">
        <div class="panel__head">
          <span class="panel__title">RAW PARSED LOG STREAM</span>
          <span class="panel__sub">WAITING…</span>
        </div>
      </div>
    `;
  }

  setLogs(analysis: ParsedLogAnalysis, logs: RawLogItem[]): void {
    const rows = logs
      .map((log) => this.renderRow(log))
      .join('');
    this.container.innerHTML = `
      <div class="panel telemetry-panel" data-testid="telemetry-stream">
        <div class="panel__head">
          <span class="panel__title">RAW PARSED LOG STREAM</span>
          <span class="panel__sub" data-testid="telemetry-count">
            ${analysis.summary.totalLogsParsed} LOGS · $${analysis.summary.totalBackendWasteUsd.toPrecision(3)} BATCH WASTE
          </span>
        </div>
        <div class="telemetry-body">
          ${rows}
        </div>
      </div>
    `;
  }

  private renderRow(log: RawLogItem): string {
    const sourceClass = log.source === 'aws'
      ? 'source-aws'
      : log.source === 'vercel'
        ? 'source-vercel'
        : log.source === 'shopify'
          ? 'source-shopify'
          : 'source-unknown';
    const badge = `
      <span class="source-pill ${sourceClass}">
        ${log.source.toUpperCase()}
      </span>
    `;
    const cold = log.isColdStart === true
      ? '<span class="cold-mark">COLD</span>'
      : '';
    const detail = typeof log.query === 'string' && log.query !== ''
      ? log.query
      : typeof log.route === 'string'
        ? log.route
        : log.serviceName;
    const duration =
      typeof log.durationMs === 'number'
        ? `<span class="telemetry-row__duration">${log.durationMs} ms</span>`
        : '';
    return `
      <div class="telemetry-row" data-testid="telemetry-entry">
        <span class="telemetry-row__time">${this.formatTime(log.timestamp)}</span>
        ${badge}
        <span class="telemetry-row__service">${this.escapeHtml(log.serviceName)}</span>
        <span class="telemetry-row__detail">${this.escapeHtml(detail)}</span>
        ${cold}
        ${duration}
      </div>
    `;
  }

  private formatTime(timestamp: string): string {
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) return '--:--:--';
    return new Date(parsed).toISOString().slice(11, 23);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}