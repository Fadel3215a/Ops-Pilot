import type { ParsedLogAnalysis } from '../../../telemetry/parser/types';
import { backendMonthlyUsd } from '../seed';

export class BackendWasteCard {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderIdle();
  }

  private renderIdle(): void {
    this.container.innerHTML = `
      <div class="panel" data-testid="backend-waste">
        <div class="panel__head">
          <span class="panel__title">BACK-END CLOUD COMPUTE WASTE</span>
          <span class="panel__sub">/ MO · SERVERLESS + WEBHOOK + DB</span>
        </div>
        <div class="waste-grid">Waiting for log telemetry…</div>
      </div>
    `;
  }

  setResult(analysis: ParsedLogAnalysis): void {
    const cold = analysis.coldStarts;
    const sync = analysis.syncLoops;
    const db = analysis.databaseBottlenecks;

    this.container.innerHTML = `
      <div class="panel" data-testid="backend-waste">
        <div class="panel__head">
          <span class="panel__title">BACK-END CLOUD COMPUTE WASTE</span>
          <span class="panel__sub">/ MO · SERVERLESS + WEBHOOK + DB</span>
        </div>
        <div class="waste-grid">
          ${this.renderSubCard('COLD START LATENCY', 'cold-start-card', [
            ['COLD EXECUTIONS', 'cold-count', String(cold.count)],
            ['LATENCY', 'cold-latency', `${cold.totalLatencyMs.toLocaleString('en-US')} ms`],
            ['WASTE', 'cold-waste', this.formatUsd(backendMonthlyUsd(cold.estimatedWasteUsd))],
          ])}
          ${this.renderSubCard('REDUNDANT SYNC LOOPS', 'sync-loop-card', [
            ['LOOPS DETECTED', 'sync-loops', String(sync.detectedLoopsCount)],
            ['DUPLICATE CALLS', 'sync-redundant', String(sync.redundantCallCount)],
            ['WASTE', 'sync-waste', this.formatUsd(backendMonthlyUsd(sync.estimatedWasteUsd))],
          ])}
          ${this.renderSubCard('DATABASE BOTTLENECKS', 'db-bottleneck-card', [
            ['SLOW / N+1 QUERIES', 'db-slow', String(db.slowQueryCount)],
            ['AVG QUERY DURATION', 'db-avg', `${db.avgSlowQueryMs.toFixed(1)} ms`],
            ['WASTE', 'db-waste', this.formatUsd(backendMonthlyUsd(db.estimatedWasteUsd))],
          ])}
        </div>
        <div class="waste-total" data-testid="backend-waste-total">
          TOTAL BACK-END WASTE
          <strong>${this.formatUsd(backendMonthlyUsd(analysis.summary.totalBackendWasteUsd))}</strong>/ mo
        </div>
      </div>
    `;
  }

  private renderSubCard(
    title: string,
    testId: string,
    rows: [label: string, testId: string, value: string][],
  ): string {
    const rowsHtml = rows
      .map(
        ([label, rowTestId, value]) => `
          <div class="waste-row">
            <span class="waste-row__label">${label}</span>
            <span class="waste-row__value" data-testid="${rowTestId}">${value}</span>
          </div>
        `,
      )
      .join('');
    return `
      <div class="waste-card" data-testid="${testId}">
        <span class="waste-card__title">${title}</span>
        ${rowsHtml}
      </div>
    `;
  }

  private formatUsd(value: number): string {
    return `$${value.toFixed(2)}`;
  }
}