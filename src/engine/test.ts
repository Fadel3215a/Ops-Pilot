import { scanUrl } from '../scanner/index';
import { calculateLoss } from './index';
import { DEFAULT_BASELINE } from './types';

const DEFAULT_TARGET = 'https://www.demoblaze.com/';
const target =
  typeof process.env.SCAN_URL === 'string' && process.env.SCAN_URL.trim() !== ''
    ? process.env.SCAN_URL.trim()
    : DEFAULT_TARGET;

const pct = (value: number, digits = 2): string => `${value.toFixed(digits)}%`;
const usd = (value: number): string => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

async function main(): Promise<void> {
  const scanResult = await scanUrl(target);

  const loss = calculateLoss(scanResult, DEFAULT_BASELINE);

  console.log('============================================');
  console.log('  OPSPILOT AI - LOSS QUANTIFICATION REPORT');
  console.log('============================================');
  console.log(`Target             : ${scanResult.url}`);
  console.log(`Scan timestamp     : ${scanResult.timestamp}`);
  console.log('');
  console.log('--- Scan Metrics ---');
  console.log(`LCP                : ${scanResult.performance.lcp.toFixed(0)} ms (baseline 1500 ms)`);
  console.log(`TBT                : ${scanResult.performance.totalBlockingTime.toFixed(0)} ms (baseline 200 ms)`);
  console.log(`Total payload      : ${(scanResult.performance.totalPayloadBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Security headers   : score ${scanResult.securityHeaders.score}/100`);
  console.log('');
  console.log('--- Penalty Vectors ---');
  console.log(`LCP penalty        : ${pct(loss.metrics.lcpPenaltyPercent)}`);
  console.log(`TBT penalty        : ${pct(loss.metrics.tbtPenaltyPercent)}`);
  console.log(`Payload penalty    : ${pct(loss.metrics.payloadPenaltyPercent)}`);
  console.log('');
  console.log('--- Store Baseline ---');
  console.log(`Monthly traffic    : ${DEFAULT_BASELINE.monthlyTraffic.toLocaleString('en-US')}`);
  console.log(`AOV                : ${usd(DEFAULT_BASELINE.aov)}`);
  console.log(`Baseline conv. rate: ${pct(DEFAULT_BASELINE.baselineConversionRate * 100)}`);
  console.log('');
  console.log('--- Loss Analysis ---');
  console.log(`Effective conv.    : ${pct(loss.effectiveConversionRate * 100, 4)}`);
  console.log(`Lost conv. points  : ${loss.lostConversionPoints.toFixed(3)}`);
  console.log(`Latency loss       : ${usd(loss.breakdown.latencyLossUsd)}/mo`);
  console.log(`Bloat loss         : ${usd(loss.breakdown.bloatLossUsd)}/mo`);
  console.log(`Security risk loss : ${usd(loss.breakdown.securityRiskUsd)}/mo`);
  console.log('--------------------------------------------');
  console.log(`Estimated monthly  : ${usd(loss.estimatedMonthlyLossUsd)}/mo`);
  console.log('============================================');

  if (scanResult.error) {
    console.error(`Scan error: ${scanResult.error}`);
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected loss engine failure:', err);
  process.exitCode = 1;
});