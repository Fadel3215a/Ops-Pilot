import assert from 'node:assert';
import {
  CRITICAL_BACKEND_WASTE,
  defaultRules,
  dispatchAlerts,
  evaluateAlerts,
  LOSS_CEILING_EXCEEDED,
  PERFORMANCE_REGRESSION,
} from './alerts';
import type { AlertPayload } from './alerts';
import type { AuditSnapshot } from './types';

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

function snapshot(
  partial: Partial<AuditSnapshot>,
  id = 'snapshot-uuid',
): AuditSnapshot {
  return {
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    targetUrl: 'https://store.example.com/',
    frontendLossUsd: 0,
    backendWasteUsd: 0,
    combinedLossUsd: 0,
    topFixId: null,
    performanceScore: 100,
    ...partial,
  };
}

interface WebhookCall {
  url: string;
  body: Record<string, unknown>;
}

function installMockFetch(calls: WebhookCall[], failWith?: Error): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, body: (body as Record<string, unknown>) ?? {} });
    if (failWith !== undefined) throw failWith;
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
}

async function main(): Promise<void> {
  await run('LOSS_CEILING_EXCEEDED fires above the default $10k ceiling', () => {
    assert.strictEqual(LOSS_CEILING_EXCEEDED.condition(snapshot({ combinedLossUsd: 12_000 })), true);
    assert.strictEqual(LOSS_CEILING_EXCEEDED.condition(snapshot({ combinedLossUsd: 10_000 })), false);
    assert.strictEqual(LOSS_CEILING_EXCEEDED.condition(snapshot({ combinedLossUsd: 9_999 })), false);
  });

  await run('PERFORMANCE_REGRESSION fires on a >= 15 point drop', () => {
    const previous = snapshot({ performanceScore: 80 });
    assert.strictEqual(
      PERFORMANCE_REGRESSION.condition(snapshot({ performanceScore: 60 }), previous),
      true,
    );
    assert.strictEqual(
      PERFORMANCE_REGRESSION.condition(snapshot({ performanceScore: 66 }), previous),
      false,
    );
    assert.strictEqual(
      PERFORMANCE_REGRESSION.condition(snapshot({ performanceScore: 40 }), undefined),
      false,
    );
  });

  await run('CRITICAL_BACKEND_WASTE fires above the $50 threshold', () => {
    assert.strictEqual(CRITICAL_BACKEND_WASTE.condition(snapshot({ backendWasteUsd: 51 })), true);
    assert.strictEqual(CRITICAL_BACKEND_WASTE.condition(snapshot({ backendWasteUsd: 50 })), false);
  });

  await run('evaluateAlerts fires only matching rules with formatted payloads', () => {
    const alarmSnapshot = snapshot({
      id: 'alarm-1',
      combinedLossUsd: 12_345,
      frontendLossUsd: 10_000,
      backendWasteUsd: 80,
      performanceScore: 55,
      topFixId: 'LCP_IMAGE_PRELOAD',
    });
    const previous = snapshot({ performanceScore: 60, combinedLossUsd: 2000 });

    const payloads = evaluateAlerts(alarmSnapshot, previous);
    assert.strictEqual(payloads.length, 2);

    const ids = payloads.map((payload) => payload.headline);
    assert.ok(ids.some((h) => h.includes('Loss Ceiling')));
    assert.ok(ids.some((h) => h.includes('Critical Backend Waste')));
    assert.ok(!ids.some((h) => h.includes('Performance Regression')));

    for (const payload of payloads) {
      assert.strictEqual(payload.snapshotId, 'alarm-1');
      assert.strictEqual(payload.targetUrl, 'https://store.example.com/');
      assert.ok(payload.details.length > 0);
    }

    const ceiling = payloads.find((p) => p.headline.includes('Loss Ceiling'));
    assert.strictEqual(ceiling?.severity, 'critical');
    assert.ok(ceiling?.details.includes('$12,345/mo'));

    const waste = payloads.find((p) => p.headline.includes('Backend Waste'));
    assert.strictEqual(waste?.severity, 'critical');
    assert.ok(waste?.details.includes('$80/mo'));
  });

  await run('evaluateAlerts triggers regression when both losses are low', () => {
    const previous = snapshot({ performanceScore: 96 });
    const current = snapshot({ performanceScore: 74, combinedLossUsd: 100 });
    const payloads = evaluateAlerts(current, previous);
    assert.strictEqual(payloads.length, 1);
    const payload = payloads[0];
    assert.strictEqual(payload.severity, 'warning');
    assert.ok(payload.details.includes('96'));
    assert.ok(payload.details.includes('74'));
    assert.ok(payload.details.includes('22 pts'));
  });

  await run('evaluateAlerts emits nothing on a healthy snapshot', () => {
    const payloads = evaluateAlerts(
      snapshot({ combinedLossUsd: 100, performanceScore: 95, backendWasteUsd: 10 }),
      snapshot({ performanceScore: 94 }),
    );
    assert.deepStrictEqual(payloads, []);
  });

  await run('evaluateAlerts honors custom rules', () => {
    const custom: typeof defaultRules = [
      {
        id: 'CUSTOM_FLAG',
        name: 'Custom Flag',
        severity: 'info',
        condition: (s) => s.topFixId === 'DB_N1_BATCH',
      },
    ];
    const payloads = evaluateAlerts(
      snapshot({ topFixId: 'DB_N1_BATCH' }),
      undefined,
      custom,
    );
    assert.strictEqual(payloads.length, 1);
    assert.strictEqual(payloads[0].headline, 'Custom Flag');
    assert.strictEqual(payloads[0].severity, 'info');
  });

  await run('dispatchAlerts sends unified webhook JSON and returns count', async () => {
    const calls: WebhookCall[] = [];
    const payloads: AlertPayload[] = [
      {
        snapshotId: 'a',
        targetUrl: 'https://store.example.com/',
        severity: 'critical',
        headline: 'Loss Ceiling Exceeded',
        details: 'Combined loss **$12,345/mo**',
      },
      {
        snapshotId: 'b',
        targetUrl: 'https://store.example.com/',
        severity: 'warning',
        headline: 'Performance Regression',
        details: 'Score dropped',
      },
    ];
    const count = await dispatchAlerts(
      payloads,
      'https://hooks.slack.com/services/T/CH',
      installMockFetch(calls),
    );
    assert.strictEqual(count, 2);
    assert.strictEqual(calls.length, 2);
    for (const call of calls) {
      assert.strictEqual(call.url, 'https://hooks.slack.com/services/T/CH');
      assert.strictEqual(call.body.username, 'OpsPilot Watchdog');
      assert.ok(Array.isArray(call.body.blocks));
      assert.ok(typeof call.body.embeds === 'object');
    }
    assert.strictEqual(calls[0].body.text, 'Loss Ceiling Exceeded');
    assert.ok(String(calls[0].body.content).includes('$12,345/mo'));
    assert.strictEqual(calls[1].body.text, 'Performance Regression');
  });

  await run('dispatchAlerts prefers payload-level webhookUrl', async () => {
    const calls: WebhookCall[] = [];
    const payloads: AlertPayload[] = [
      {
        snapshotId: 'a',
        targetUrl: 'https://store.example.com/',
        severity: 'info',
        headline: 'h',
        details: 'd',
        webhookUrl: 'https://discord.com/api/webhooks/000/AAA',
      },
    ];
    const count = await dispatchAlerts(
      payloads,
      'https://hooks.slack.com/services/T/CH',
      installMockFetch(calls),
    );
    assert.strictEqual(count, 1);
    assert.strictEqual(calls[0].url, 'https://discord.com/api/webhooks/000/AAA');
  });

  await run('dispatchAlerts skips payloads without a webhook target', async () => {
    const calls: WebhookCall[] = [];
    const payloads: AlertPayload[] = [
      {
        snapshotId: 'a',
        targetUrl: 'https://store.example.com/',
        severity: 'critical',
        headline: 'h',
        details: 'd',
      },
    ];
    const count = await dispatchAlerts(payloads, undefined, installMockFetch(calls));
    assert.strictEqual(count, 0);
    assert.strictEqual(calls.length, 0);
  });

  await run('dispatchAlerts survives transport failures', async () => {
    const calls: WebhookCall[] = [];
    const payloads: AlertPayload[] = [
      {
        snapshotId: 'a',
        targetUrl: 'https://store.example.com/',
        severity: 'critical',
        headline: 'h',
        details: 'd',
      },
    ];
    const failing = installMockFetch(calls, new Error('network down'));
    const count = await dispatchAlerts(payloads, 'https://hooks.example.com/h', failing);
    assert.strictEqual(count, 0);
    assert.strictEqual(calls.length, 1);
  });

  await run('default rules include all three detectors', () => {
    assert.strictEqual(defaultRules.length, 3);
    assert.deepStrictEqual(
      defaultRules.map((rule) => rule.id),
      ['LOSS_CEILING_EXCEEDED', 'PERFORMANCE_REGRESSION', 'CRITICAL_BACKEND_WASTE'],
    );
  });

  console.log(`\nTelemetry alerting: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});