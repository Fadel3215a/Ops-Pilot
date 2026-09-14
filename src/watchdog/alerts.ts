import type { AuditSnapshot } from './types';

export interface AlertTriggerRule {
  id: string;
  name: string;
  condition: (snapshot: AuditSnapshot, previous?: AuditSnapshot) => boolean;
  severity: 'critical' | 'warning' | 'info';
}

export interface AlertPayload {
  snapshotId: string;
  targetUrl: string;
  severity: 'critical' | 'warning' | 'info';
  headline: string;
  details: string;
  webhookUrl?: string;
}

export const LOSS_CEILING_USD = 10_000;
export const BACKEND_WASTE_USD = 50;
export const REGRESSION_SCORE_DROP = 15;

export const LOSS_CEILING_EXCEEDED: AlertTriggerRule = {
  id: 'LOSS_CEILING_EXCEEDED',
  name: 'Loss Ceiling Exceeded',
  severity: 'critical',
  condition: (snapshot) => snapshot.combinedLossUsd > LOSS_CEILING_USD,
};

export const PERFORMANCE_REGRESSION: AlertTriggerRule = {
  id: 'PERFORMANCE_REGRESSION',
  name: 'Performance Regression',
  severity: 'warning',
  condition: (snapshot, previous) =>
    previous !== undefined &&
    previous.performanceScore - snapshot.performanceScore >= REGRESSION_SCORE_DROP,
};

export const CRITICAL_BACKEND_WASTE: AlertTriggerRule = {
  id: 'CRITICAL_BACKEND_WASTE',
  name: 'Critical Backend Waste',
  severity: 'critical',
  condition: (snapshot) => snapshot.backendWasteUsd > BACKEND_WASTE_USD,
};

export const defaultRules: AlertTriggerRule[] = [
  LOSS_CEILING_EXCEEDED,
  PERFORMANCE_REGRESSION,
  CRITICAL_BACKEND_WASTE,
];

export function evaluateAlerts(
  snapshot: AuditSnapshot,
  previous?: AuditSnapshot,
  rules: AlertTriggerRule[] = defaultRules,
): AlertPayload[] {
  return rules
    .filter((rule) => rule.condition(snapshot, previous))
    .map((rule) => buildAlertPayload(rule, snapshot, previous));
}

function buildAlertPayload(
  rule: AlertTriggerRule,
  snapshot: AuditSnapshot,
  previous?: AuditSnapshot,
): AlertPayload {
  switch (rule.id) {
    case 'LOSS_CEILING_EXCEEDED':
      return {
        snapshotId: snapshot.id,
        targetUrl: snapshot.targetUrl,
        severity: rule.severity,
        headline: `🚨 ${rule.name}`,
        details: [
          `Combined loss **$${snapshot.combinedLossUsd.toLocaleString('en-US')}/mo** exceeds the $${LOSS_CEILING_USD.toLocaleString('en-US')} ceiling.`,
          '',
          '- ' + ['Frontend', snapshot.frontendLossUsd].join(': $'),
          '- ' + ['Backend', snapshot.backendWasteUsd].join(': $'),
          '- ' + ['Score', snapshot.performanceScore].join(': '),
        ].join('\n'),
      };
    case 'PERFORMANCE_REGRESSION':
      return {
        snapshotId: snapshot.id,
        targetUrl: snapshot.targetUrl,
        severity: rule.severity,
        headline: `⚠️ ${rule.name}`,
        details: [
          `Score dropped \`${previous?.performanceScore}\` → \`${snapshot.performanceScore}\` (−${previous?.performanceScore !== undefined ? previous.performanceScore - snapshot.performanceScore : '?'} pts).`,
          '',
          '- ' + ['Combined loss', snapshot.combinedLossUsd].join(': $'),
          '- ' + ['Top fix', snapshot.topFixId ?? 'none'].join(': '),
        ].join('\n'),
      };
    case 'CRITICAL_BACKEND_WASTE':
      return {
        snapshotId: snapshot.id,
        targetUrl: snapshot.targetUrl,
        severity: rule.severity,
        headline: `🔥 ${rule.name}`,
        details: [
          `Backend waste **$${snapshot.backendWasteUsd.toLocaleString('en-US')}/mo** exceeds the $${BACKEND_WASTE_USD.toLocaleString('en-US')} threshold.`,
          '',
          '- ' + ['Combined loss', snapshot.combinedLossUsd].join(': $'),
          '- ' + ['Score', snapshot.performanceScore].join(': '),
        ].join('\n'),
      };
    default:
      return {
        snapshotId: snapshot.id,
        targetUrl: snapshot.targetUrl,
        severity: rule.severity,
        headline: rule.name,
        details: `Rule ${rule.id} triggered on ${snapshot.targetUrl}.`,
      };
  }
}

export async function dispatchAlerts(
  payloads: AlertPayload[],
  webhookUrl?: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<number> {
  let dispatched = 0;
  for (const payload of payloads) {
    const targetUrl = payload.webhookUrl ?? webhookUrl;
    if (targetUrl === undefined) continue;
    try {
      const response = await fetchFn(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: payload.headline,
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: payload.details } }],
          content: payload.details,
          username: 'OpsPilot Watchdog',
          embeds: [{ title: payload.headline, description: payload.details }],
        }),
      });
      if (response.ok) dispatched += 1;
    } catch {
      // failed dispatch does not throw
    }
  }
  return dispatched;
}