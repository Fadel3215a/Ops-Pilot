import { readFile } from 'node:fs/promises';
import type { RawLogItem } from '../../telemetry/parser/types';
import { runAuditCycle, syntheticScanResult } from '../../watchdog';
import type { CliCommandArgs, CliDeps } from '../args';

export async function loadRawLogItems(logsPath?: string): Promise<RawLogItem[]> {
  if (!logsPath) return [];
  const raw = await readFile(logsPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`--logs must reference a JSON array of RawLogItem, got ${typeof parsed}`);
  }
  return parsed as RawLogItem[];
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

export async function auditCommand(
  args: CliCommandArgs,
  deps: CliDeps = {},
): Promise<number> {
  if (!args.url) {
    console.error('opspilot audit: missing --url/--target');
    return 1;
  }

  const logItems = await loadRawLogItems(args.logsPath);
  const snapshot = await runAuditCycle(args.url, logItems, {
    scan: deps.scan ?? (args.dryRun ? syntheticScanResult : undefined),
  });

  console.log('OpsPilot Audit');
  console.log(`  target:               ${snapshot.targetUrl}`);
  console.log(`  frontend loss:        ${usd(snapshot.frontendLossUsd)}/mo`);
  console.log(`  backend waste:        ${usd(snapshot.backendWasteUsd)}/mo`);
  console.log(`  combined loss:        ${usd(snapshot.combinedLossUsd)}/mo`);
  console.log(`  performance score:    ${snapshot.performanceScore}/100`);
  console.log(`  logs parsed:          ${logItems.length}`);
  console.log(`  top fix:              ${snapshot.topFixId ?? 'none'}`);
  return 0;
}