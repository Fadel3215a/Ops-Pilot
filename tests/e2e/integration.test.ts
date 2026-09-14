import assert from 'node:assert';
import { execFile as execFileCb } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { calculateLoss } from '../../src/engine';
import { generatePatchForFix } from '../../src/patching/ast';
import { createRemediationPR } from '../../src/patching/github';
import { generateRemediationPlan } from '../../src/remediation';
import { parseLogs } from '../../src/telemetry/parser';
import { RAW_LOGS_FIXTURE } from '../../src/telemetry/parser/fixtures';
import {
  clearHistory,
  syntheticScanResult,
  WatchdogDaemon,
} from '../../src/watchdog';

const execFile = promisify(execFileCb);

const ROOT = process.cwd();
const BIN = path.join(ROOT, 'dist', 'opspilot.cjs');
const TARGET_URL = 'https://store.example.com/';
const TEMP_HISTORY = path.join(os.tmpdir(), 'watchdog-e2e.test.json');

let passed = 0;
let failed = 0;

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${String(error).split('\n').slice(0, 4).join('\n      ')}`,
    );
  }
}

async function runNodeCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFileCb(process.execPath, [BIN, ...args], { cwd: ROOT }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

interface WebhookCall {
  url: string;
  body: Record<string, unknown>;
}

function mockWebhook(calls: WebhookCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body:
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
}

async function withTempHistory<T>(fn: (file: string) => Promise<T>): Promise<T> {
  await clearHistory(TEMP_HISTORY);
  try {
    return await fn(TEMP_HISTORY);
  } finally {
    await rm(TEMP_HISTORY, { force: true });
  }
}

async function main(): Promise<void> {
  await run('e2e: scanner + loss engine quantify a synthetic storefront', () => {
    const scanResult = syntheticScanResult(TARGET_URL);
    const loss = calculateLoss(scanResult);
    assert.ok(loss.estimatedMonthlyLossUsd > 0, 'frontend loss is non-zero');
    assert.ok(loss.breakdown.latencyLossUsd >= 0, 'breakdown present');
  });

  await run('e2e: telemetry parser summarizes backend waste', () => {
    const parsed = parseLogs(RAW_LOGS_FIXTURE);
    assert.ok(parsed.summary.totalLogsParsed > 0, 'parsed some logs');
    assert.ok(
      parsed.summary.totalBackendWasteUsd > 0,
      'backend waste is non-zero',
    );
  });

  await run('e2e: remediation plan ranks actionable fixes', () => {
    const loss = calculateLoss(syntheticScanResult(TARGET_URL));
    const parsed = parseLogs(RAW_LOGS_FIXTURE);
    const plan = generateRemediationPlan(loss, parsed);
    assert.ok(plan.fixes.length > 0, 'at least one fix proposed');
    assert.strictEqual(plan.fixes[0].id, 'LCP_IMAGE_PRELOAD');
    assert.ok(plan.totalMonthlySavingsUsd > 0, 'savings quantified');
  });

  await run('e2e: AST patcher emits diffs for every fix', () => {
    const loss = calculateLoss(syntheticScanResult(TARGET_URL));
    const parsed = parseLogs(RAW_LOGS_FIXTURE);
    const plan = generateRemediationPlan(loss, parsed);
    const patches = plan.fixes.map((fix) => generatePatchForFix(fix));
    assert.ok(patches.length === plan.fixes.length, 'one patch per fix');
    for (const patch of patches) {
      assert.ok(patch.hasSyntaxError === false, `${patch.fixId} parses clean`);
    }
    const lcp = patches.find((patch) => patch.fixId === 'LCP_IMAGE_PRELOAD');
    assert.ok(lcp && lcp.patchedContent !== lcp.originalContent, 'LCP patched');
    assert.ok(lcp && lcp.unifiedDiff.length > 0, 'LCP has a unified diff');
  });

  await run('e2e: GitHub automator dry-runs a PR without network', async () => {
    const loss = calculateLoss(syntheticScanResult(TARGET_URL));
    const parsed = parseLogs(RAW_LOGS_FIXTURE);
    const plan = generateRemediationPlan(loss, parsed);
    const patches = plan.fixes.map((fix) => generatePatchForFix(fix));

    const result = await createRemediationPR(
      patches,
      { owner: 'acme', repo: 'storefront', token: 'test-token', baseBranch: 'main' },
      { dryRun: true },
    );
    assert.strictEqual(result.status, 'dry-run');
    assert.ok(result.prUrl.includes('acme/storefront/pull/'), result.prUrl);
    assert.ok(/^opspilot\/(fix-|remediation-batch-)/.test(result.branchName));
  });

  await run('e2e: watchdog daemon tick dispatches formatted webhook payloads', async () => {
    await withTempHistory(async (file) => {
      const calls: WebhookCall[] = [];
      const loss = calculateLoss(syntheticScanResult(TARGET_URL));
      const parsed = parseLogs(RAW_LOGS_FIXTURE);

      const daemon = new WatchdogDaemon({
        targetUrl: TARGET_URL,
        intervalMs: 60_000,
        webhookUrl: 'https://hooks.example.com/alert',
        historyPath: file,
        scan: syntheticScanResult,
        logItems: RAW_LOGS_FIXTURE,
        fetchFn: mockWebhook(calls),
      });

      const snapshot = await daemon.tick();

      assert.strictEqual(snapshot.targetUrl, TARGET_URL);
      assert.strictEqual(snapshot.frontendLossUsd, loss.estimatedMonthlyLossUsd);
      assert.strictEqual(snapshot.backendWasteUsd, parsed.summary.totalBackendWasteUsd);
      assert.strictEqual(snapshot.combinedLossUsd, Math.round(loss.estimatedMonthlyLossUsd + parsed.summary.totalBackendWasteUsd));

      assert.ok(daemon.lastTickAlerts.length > 0, 'rules fired');
      assert.ok(daemon.lastDispatched > 0, 'payloads dispatched');
      assert.ok(calls.length === daemon.lastDispatched, 'one call per payload');
      assert.ok(
        calls.every((call) => call.url === 'https://hooks.example.com/alert'),
      );

      for (const call of calls) {
        assert.strictEqual(call.body.username, 'OpsPilot Watchdog');
        assert.ok(typeof call.body.text === 'string', 'headline is a string');
        assert.ok(
          (call.body.text as string).length > 0,
          'headline non-empty',
        );
        assert.strictEqual(typeof call.body.content, 'string');
        assert.ok(call.body.blocks instanceof Array, 'slack blocks present');
        assert.ok(Array.isArray(call.body.embeds), 'discord embeds present');
      }

      const ceiling = calls.find((call) =>
        String(call.body.text).includes('Loss Ceiling Exceeded'),
      );
      assert.ok(ceiling, 'loss ceiling alert dispatched');
      assert.ok(
        String(ceiling.body.content).includes('Combined loss **$'),
        'details include dollar figure',
      );
    });
  });

  await run('e2e: CLI bundle builds via esbuild', async () => {
    await execFile(process.execPath, [path.join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT });
  });

  await run('e2e: dist/opspilot.cjs --version runs clean', async () => {
    const { code, stdout, stderr } = await runNodeCli(['--version']);
    assert.strictEqual(code, 0, `code=${code} stderr=${stderr.trim()}`);
    assert.ok(stdout.includes('opspilot 1.0.0'), stdout.trim());
    assert.strictEqual(stderr, '', 'no stderr output');
  });

  await run('e2e: dist/opspilot.cjs audit --dry-run pipelines live modules', async () => {
    const { code, stdout, stderr } = await runNodeCli([
      'audit',
      '--target=https://store.example.com/',
      '--dry-run',
    ]);
    assert.strictEqual(code, 0, `code=${code} stderr=${stderr.trim()}`);
    assert.ok(stdout.includes('OpsPilot Audit'), 'audit summary rendered');
    assert.ok(stdout.includes('combined loss'), 'loss line rendered');
    assert.ok(stdout.includes('LCP_IMAGE_PRELOAD'), 'top fix surfaced');
  });

  await run('e2e: dist/opspilot.cjs rejects unknown flags with exit 1', async () => {
    const { code } = await runNodeCli(['--bogus']);
    assert.strictEqual(code, 1);
  });

  console.log(`\nSystem E2E integration: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});