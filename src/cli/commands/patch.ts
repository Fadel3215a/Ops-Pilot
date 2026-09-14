import { calculateLoss } from '../../engine';
import { generatePatchForFix } from '../../patching/ast';
import { createRemediationPR } from '../../patching/github';
import { generateRemediationPlan } from '../../remediation';
import { scanUrl } from '../../scanner';
import { parseLogs } from '../../telemetry/parser';
import { loadRawLogItems } from './audit';
import { syntheticScanResult } from '../../watchdog';
import type { CliCommandArgs, CliDeps } from '../args';

function usd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

export async function patchCommand(
  args: CliCommandArgs,
  deps: CliDeps = {},
): Promise<number> {
  if (!args.url) {
    console.error('opspilot patch: missing --url/--target');
    return 1;
  }

  const scanner = deps.scan ?? (args.dryRun ? syntheticScanResult : scanUrl);
  const logItems = await loadRawLogItems(args.logsPath);

  const scanResult = await scanner(args.url);
  const loss = calculateLoss(scanResult);
  const backend = parseLogs(logItems);
  const plan = generateRemediationPlan(loss, backend);
  const patches = plan.fixes.map((fix) => generatePatchForFix(fix));

  console.log('OpsPilot Patch Plan');
  console.log(`  target:               ${args.url}`);
  console.log(`  estimated savings:    ${usd(plan.totalMonthlySavingsUsd)}/mo`);
  console.log(`  estimated effort:     ${plan.totalEffortHours} hour(s)`);
  console.log(`  patches:              ${patches.length}`);
  for (const patch of patches) {
    console.log(`    - ${patch.targetPath} [${patch.fixId}] (${patch.hasSyntaxError ? 'syntax error' : 'clean'})`);
  }

  if (!args.repo) {
    console.log('  note: pass --repo=<owner/name> to open a GitHub PR');
    return 0;
  }

  const [owner, repo] = args.repo.split('/');
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  if (!args.dryRun && !token) {
    console.error('opspilot patch: --repo requires GITHUB_TOKEN (or use --dry-run)');
    return 1;
  }

  const result = await createRemediationPR(
    patches,
    { owner, repo, token: token ?? 'dry-run', baseBranch: 'main' },
    { dryRun: args.dryRun, fetchFn: deps.fetchFn },
  );
  console.log(`  pr:                   ${result.branchName} -> ${result.prUrl} [${result.status}]`);
  return 0;
}