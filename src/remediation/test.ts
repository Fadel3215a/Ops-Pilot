import assert from 'node:assert/strict';
import { calculateLoss } from '../engine';
import type { ScanResult } from '../scanner/types';
import { parseLogs, RAW_LOGS_FIXTURE } from '../telemetry/parser';
import {
  generateBackendFixes,
  BACKEND_MONTHLY_MULTIPLIER,
  WARMER_SAVINGS_SHARE,
  WARMER_EFFORT_HOURS,
  WEBHOOK_DEDUPE_SAVINGS_SHARE,
  WEBHOOK_DEDUPE_EFFORT_HOURS,
  DB_N1_SAVINGS_SHARE,
  DB_N1_EFFORT_HOURS,
} from './backendFixes';
import {
  generateFrontendFixes,
  LCP_SAVINGS_SHARE,
  LCP_EFFORT_HOURS,
  SCRIPT_DEFER_SAVINGS_SHARE,
  SCRIPT_DEFER_EFFORT_HOURS,
  SECURITY_HEADERS_SAVINGS_SHARE,
  SECURITY_HEADERS_EFFORT_HOURS,
} from './frontendFixes';
import { generateRemediationPlan } from './index';
import { computeRoiScore, sortFixesByRoi } from './planner';
import type { ActionableFix } from './types';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function badScan(): ScanResult {
  return {
    url: 'https://www.demoblaze.com/',
    timestamp: '2026-09-14T10:00:00.000Z',
    performance: {
      ttfb: 3101,
      lcp: 3548,
      totalBlockingTime: 0,
      totalPayloadBytes: 692165,
    },
    dom: { totalNodes: 375, maxDepth: 16, scriptTagCount: 6, inlineScriptCount: 0, externalScriptCount: 6 },
    thirdParty: { scriptCount: 6, payloadBytes: 692165, domains: ['code.jquery.com'] },
    securityHeaders: { hsts: false, csp: false, xFrameOptions: null, xContentTypeOptions: false, score: 0 },
    payloadBytesByType: { javascript: 610000, css: 48000, image: 25000, font: 0 },
    error: null,
  };
}

function pristineScan(): ScanResult {
  return {
    url: 'https://fast.example.com/',
    timestamp: '2026-09-14T10:00:00.000Z',
    performance: { ttfb: 350, lcp: 900, totalBlockingTime: 0, totalPayloadBytes: 350000 },
    dom: { totalNodes: 120, maxDepth: 12, scriptTagCount: 1, inlineScriptCount: 0, externalScriptCount: 1 },
    thirdParty: { scriptCount: 1, payloadBytes: 80000, domains: [] },
    securityHeaders: { hsts: true, csp: true, xFrameOptions: 'DENY', xContentTypeOptions: true, score: 100 },
    payloadBytesByType: { javascript: 60000, css: 10000, image: 8000, font: 2000 },
    error: null,
  };
}

function findBy(fixes: ActionableFix[], id: string): ActionableFix {
  const fix = fixes.find((candidate) => candidate.id === id);
  assert.ok(fix !== undefined, `missing fix ${id}`);
  return fix as ActionableFix;
}

function main(): void {
  const loss = calculateLoss(badScan());
  const backend = parseLogs(RAW_LOGS_FIXTURE);

  check('front-end generator emits all three fixes on a slow store', () => {
    const fixes = generateFrontendFixes(loss);
    assert.equal(fixes.length, 3);
    assert.deepEqual(
      fixes.map((fix) => fix.id),
      ['LCP_IMAGE_PRELOAD', 'SCRIPT_DEFER', 'SECURITY_HEADERS'],
    );
  });

  check('LCP_IMAGE_PRELOAD economy matches its savings share', () => {
    const fix = findBy(generateFrontendFixes(loss), 'LCP_IMAGE_PRELOAD');
    const expected = Math.round(loss.breakdown.latencyLossUsd * LCP_SAVINGS_SHARE);
    assert.equal(fix.monthlySavingsUsd, expected);
    assert.equal(fix.estimatedEffortHours, LCP_EFFORT_HOURS);
    assert.equal(fix.roiScore, computeRoiScore(expected, LCP_EFFORT_HOURS));
    assert.equal(fix.category, 'performance');
    assert.ok(fix.suggestedCodeDiff.includes('preload'));
  });

  check('SCRIPT_DEFER carries the defer directive', () => {
    const fix = findBy(generateFrontendFixes(loss), 'SCRIPT_DEFER');
    assert.equal(fix.monthlySavingsUsd, Math.round(loss.breakdown.bloatLossUsd * SCRIPT_DEFER_SAVINGS_SHARE));
    assert.equal(fix.estimatedEffortHours, SCRIPT_DEFER_EFFORT_HOURS);
    assert.ok(fix.suggestedCodeDiff.includes('defer'));
  });

  check('SECURITY_HEADERS lists HSTS, CSP and nosniff', () => {
    const fix = findBy(generateFrontendFixes(loss), 'SECURITY_HEADERS');
    assert.equal(fix.monthlySavingsUsd, Math.round(loss.breakdown.securityRiskUsd * SECURITY_HEADERS_SAVINGS_SHARE));
    assert.equal(fix.estimatedEffortHours, SECURITY_HEADERS_EFFORT_HOURS);
    assert.equal(fix.category, 'security');
    assert.ok(fix.suggestedCodeDiff.includes('Strict-Transport-Security'));
    assert.ok(fix.suggestedCodeDiff.includes('Content-Security-Policy'));
    assert.ok(fix.suggestedCodeDiff.includes('X-Content-Type-Options'));
  });

  check('back-end generator emits one fix per detected vector', () => {
    const fixes = generateBackendFixes(backend);
    assert.equal(fixes.length, 3);
    assert.deepEqual(
      fixes.map((fix) => fix.id),
      ['SERVERLESS_WARMER', 'WEBHOOK_DEDUPE', 'DB_N1_BATCH'],
    );
  });

  check('SERVERLESS_WARMER savings scale cold-start waste monthly', () => {
    const fix = findBy(generateBackendFixes(backend), 'SERVERLESS_WARMER');
    const expected = Math.round(backend.coldStarts.estimatedWasteUsd * WARMER_SAVINGS_SHARE * BACKEND_MONTHLY_MULTIPLIER);
    assert.equal(fix.monthlySavingsUsd, expected);
    assert.equal(fix.estimatedEffortHours, WARMER_EFFORT_HOURS);
    assert.equal(fix.category, 'serverless');
    assert.ok(fix.suggestedCodeDiff.includes('provisionedConcurrency'));
  });

  check('WEBHOOK_DEDUPE proposes an idempotency cache', () => {
    const fix = findBy(generateBackendFixes(backend), 'WEBHOOK_DEDUPE');
    const expected = Math.round(backend.syncLoops.estimatedWasteUsd * WEBHOOK_DEDUPE_SAVINGS_SHARE * BACKEND_MONTHLY_MULTIPLIER);
    assert.equal(fix.monthlySavingsUsd, expected);
    assert.equal(fix.estimatedEffortHours, WEBHOOK_DEDUPE_EFFORT_HOURS);
    assert.equal(fix.category, 'architecture');
    assert.ok(fix.suggestedCodeDiff.includes('setnx'));
  });

  check('DB_N1_BATCH suggests bulk IN batch loading', () => {
    const fix = findBy(generateBackendFixes(backend), 'DB_N1_BATCH');
    const expected = Math.round(backend.databaseBottlenecks.estimatedWasteUsd * DB_N1_SAVINGS_SHARE * BACKEND_MONTHLY_MULTIPLIER);
    assert.equal(fix.monthlySavingsUsd, expected);
    assert.equal(fix.estimatedEffortHours, DB_N1_EFFORT_HOURS);
    assert.equal(fix.category, 'database');
    assert.ok(fix.suggestedCodeDiff.includes('IN (?,'));
  });

  check('plan aggregates, sorts by ROI and balances totals', () => {
    const plan = generateRemediationPlan(loss, backend);
    assert.equal(plan.fixes.length, 6);
    for (let i = 1; i < plan.fixes.length; i += 1) {
      assert.ok(
        plan.fixes[i - 1].roiScore >= plan.fixes[i].roiScore,
        `out of order at index ${i}`,
      );
    }
    assert.equal(
      plan.totalMonthlySavingsUsd,
      plan.fixes.reduce((sum, fix) => sum + fix.monthlySavingsUsd, 0),
    );
    assert.equal(
      plan.totalEffortHours,
      plan.fixes.reduce((sum, fix) => sum + fix.estimatedEffortHours, 0),
    );
    assert.ok(plan.totalMonthlySavingsUsd > 0);
    assert.ok(plan.fixes.every((fix) => fix.targetPath.length > 0));
    assert.ok(plan.fixes.every((fix) => fix.description.length > 0));
  });

  check('LCP preload ranks highest by USD per engineering hour', () => {
    const plan = generateRemediationPlan(loss, backend);
    assert.equal(plan.fixes[0].id, 'LCP_IMAGE_PRELOAD');
  });

  check('pristine storefront produces zero front-end fixes', () => {
    const cleanLoss = calculateLoss(pristineScan());
    assert.equal(cleanLoss.estimatedMonthlyLossUsd, 0);
    assert.equal(generateFrontendFixes(cleanLoss).length, 0);
  });

  check('empty backend telemetry produces zero back-end fixes', () => {
    const empty = parseLogs([]);
    assert.equal(generateBackendFixes(empty).length, 0);
  });

  check('roi scoring and sorting are deterministic', () => {
    assert.equal(computeRoiScore(120, 3), 40);
    assert.equal(computeRoiScore(119, 3), 39.7);
    assert.equal(computeRoiScore(100, 0), 0);
    const fixes = generateRemediationPlan(loss, backend).fixes;
    assert.deepEqual(sortFixesByRoi(fixes), fixes);
  });

  check('every plan fix carries a real targetPath and code spec', () => {
    const plan = generateRemediationPlan(loss, backend);
    for (const fix of plan.fixes) {
      assert.ok(
        fix.targetPath.endsWith('.ts') ||
          fix.targetPath.endsWith('.tsx') ||
          fix.targetPath.endsWith('.yml') ||
          fix.targetPath === 'next.config.ts',
      );
      assert.ok(fix.suggestedCodeDiff.length > 40);
    }
  });

  console.log(`\nRemediation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();