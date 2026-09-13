import type { ScanResult } from '../../scanner/types';

const fmtBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const fmtMs = (ms: number): string => `${Math.round(ms).toLocaleString('en-US')} ms`;

interface Metric {
  label: string;
  value: string;
  status: 'pass' | 'warn' | 'fail' | 'neutral';
}

function metricBlock(metric: Metric): string {
  const cls = `metric ${metric.status === 'fail' ? 'metric--fail' : metric.status === 'warn' ? 'metric--warn' : metric.status === 'pass' ? 'metric--pass' : 'metric--neutral'}`;
  const badge =
    metric.status === 'pass' ? 'PASS' : metric.status === 'fail' ? 'FAIL' : metric.status === 'warn' ? 'WARN' : 'INFO';
  return `
    <div class="metric ${cls}">
      <span class="metric__label">${metric.label}</span>
      <span class="metric__value">${metric.value}</span>
      <span class="metric__badge">${badge}</span>
    </div>
  `;
}

function securityBadge(name: string, present: boolean, detail: string): string {
  const state = present ? 'pass' : 'fail';
  const label = present ? 'SECURE' : 'MISSING';
  return `
    <div class="metric ${state}">
      <span class="metric__label">${name}</span>
      <span class="metric__value">${detail}</span>
      <span class="metric__badge">${label}</span>
    </div>
  `;
}

export class MetricBreakdown {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  clear(): void {
    this.container.innerHTML = '';
  }

  render(scan: ScanResult): void {
    const dom = scan.dom;
    const perf = scan.performance;
    const third = scan.thirdParty;
    const sec = scan.securityHeaders;

    const lcpStatus = perf.lcp <= 1500 ? 'pass' : perf.lcp <= 2500 ? 'warn' : 'fail';
    const tbtStatus = perf.totalBlockingTime <= 200 ? 'pass' : 'warn';
    const ttfbStatus = perf.ttfb <= 600 ? 'pass' : perf.ttfb <= 1800 ? 'warn' : 'fail';
    const payloadStatus = perf.totalPayloadBytes <= 1_572_864 ? 'pass' : 'warn';
    const scriptStatus = third.scriptCount <= 5 ? 'pass' : 'warn';

    const payloadSplit = [
      `JS ${fmtBytes(scan.payloadBytesByType.javascript)}`,
      `CSS ${fmtBytes(scan.payloadBytesByType.css)}`,
      `IMG ${fmtBytes(scan.payloadBytesByType.image)}`,
      `FONT ${fmtBytes(scan.payloadBytesByType.font)}`,
    ].join(' · ');

    const scoreMeter = Math.max(0, Math.min(sec.score, 100));

    this.container.innerHTML = `
      <div class="breakdown-grid" data-testid="metrics-grid">
        <section class="card" data-testid="metric-performance">
          <header class="card__head">
            <span class="card__kicker">VECTOR 01</span>
            <h2 class="card__title">Performance</h2>
          </header>
          <div class="card__body">
            ${metricBlock({ label: 'LCP', value: fmtMs(perf.lcp), status: lcpStatus })}
            ${metricBlock({ label: 'TBT', value: fmtMs(perf.totalBlockingTime), status: tbtStatus })}
            ${metricBlock({ label: 'TTFB', value: fmtMs(perf.ttfb), status: ttfbStatus })}
            ${metricBlock({ label: 'DOM DEPTH', value: `${dom.maxDepth} levels`, status: 'neutral' })}
          </div>
        </section>

        <section class="card" data-testid="metric-bloat">
          <header class="card__head">
            <span class="card__kicker">VECTOR 02</span>
            <h2 class="card__title">Asset Bloat</h2>
          </header>
          <div class="card__body">
            ${metricBlock({ label: 'TOTAL PAYLOAD', value: fmtBytes(perf.totalPayloadBytes), status: payloadStatus })}
            ${metricBlock({ label: '3RD-PARTY SCRIPTS', value: `${third.scriptCount} (${third.domains.length} domains)`, status: scriptStatus })}
            <div class="metric metric--neutral">
              <span class="metric__label">PAYLOAD SPLIT</span>
              <span class="metric__value metric__split">${payloadSplit}</span>
              <span class="metric__badge">INFO</span>
            </div>
          </div>
        </section>

        <section class="card" data-testid="metric-security">
          <header class="card__head">
            <span class="card__kicker">VECTOR 03</span>
            <h2 class="card__title">Security Hygiene</h2>
          </header>
          <div class="card__body">
            <div class="score-bar">
              <span class="score-bar__label">HEADER SCORE — ${sec.score}/100</span>
              <div class="score-bar__track">
                <span class="score-bar__fill" style="width: ${scoreMeter}%"></span>
              </div>
            </div>
            ${securityBadge('HSTS', sec.hsts, sec.hsts ? 'max-age enforced' : 'not present')}
            ${securityBadge('CSP', sec.csp, sec.csp ? 'policy active' : 'not present')}
            ${securityBadge(
              'X-FRAME-OPTIONS',
              sec.xFrameOptions !== null,
              sec.xFrameOptions !== null ? sec.xFrameOptions! : 'not present',
            )}
            ${securityBadge('X-CONTENT-TYPE-OPTIONS', sec.xContentTypeOptions, sec.xContentTypeOptions ? 'nosniff' : 'not present')}
          </div>
        </section>
      </div>
    `;
  }
}