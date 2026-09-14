import type { ParsedLogAnalysis } from '../telemetry/parser/types';
import { computeRoiScore } from './planner';
import type { ActionableFix } from './types';

export const BACKEND_MONTHLY_MULTIPLIER = 20_000;
export const WARMER_SAVINGS_SHARE = 0.8;
export const WARMER_EFFORT_HOURS = 3;
export const WEBHOOK_DEDUPE_SAVINGS_SHARE = 0.85;
export const WEBHOOK_DEDUPE_EFFORT_HOURS = 4;
export const DB_N1_SAVINGS_SHARE = 0.7;
export const DB_N1_EFFORT_HOURS = 5;

export function generateBackendFixes(analysis: ParsedLogAnalysis): ActionableFix[] {
  const fixes: ActionableFix[] = [];
  const scale = BACKEND_MONTHLY_MULTIPLIER;

  if (analysis.coldStarts.count > 0) {
    const savings = Math.round(
      analysis.coldStarts.estimatedWasteUsd * WARMER_SAVINGS_SHARE * scale,
    );
    fixes.push({
      id: 'SERVERLESS_WARMER',
      title: 'Add provisioned concurrency / warm-up cron',
      category: 'serverless',
      targetPath: 'infra/lambda/serverless.yml',
      monthlySavingsUsd: savings,
      estimatedEffortHours: WARMER_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, WARMER_EFFORT_HOURS),
      description:
        'Cold-start executions waste compute on initialization and inflate p95 latency. Provisioned concurrency keeps warm instances ready on AWS; a warm-up cron is the serverless-cron equivalent on Vercel.',
      suggestedCodeDiff: [
        `# infra/lambda/serverless.yml`,
        `functions:`,
        `  ordersProcessor:`,
        `    provisionedConcurrency: 1  # keeps 1 warm instance always`,
        ``,
        `// vercel.json masthead cron alternative`,
        `{ "crons": [{ "path": "/api/warm", "schedule": "*/5 * * * *" }] }`,
      ].join('\n'),
    });
  }

  if (analysis.syncLoops.redundantCallCount > 0) {
    const savings = Math.round(
      analysis.syncLoops.estimatedWasteUsd * WEBHOOK_DEDUPE_SAVINGS_SHARE * scale,
    );
    fixes.push({
      id: 'WEBHOOK_DEDUPE',
      title: 'Idempotent webhook deduplication cache',
      category: 'architecture',
      targetPath: 'src/middleware/webhookDedupe.ts',
      monthlySavingsUsd: savings,
      estimatedEffortHours: WEBHOOK_DEDUPE_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, WEBHOOK_DEDUPE_EFFORT_HOURS),
      description:
        'Recursive or retried webhook deliveries hit the same route repeatedly within seconds, re-running expensive sync loops. A short-TTL idempotency cache turns duplicate deliveries into no-ops.',
      suggestedCodeDiff: [
        `import { Redis } from '@upstash/redis';`,
        `const redis = Redis.fromEnv();`,
        ``,
        `export async function dedupeWebhook(req, next) {`,
        `  const key = \`webhook:\${req.headers['x-shopify-webhook-id']}\`;`,
        `  const first = await redis.setnx(key, '1');`,
        `  if (!first) return { status: 200, body: 'duplicate, ignored' };`,
        `  await redis.expire(key, 60 * 60 * 24);`,
        `  return next();`,
        `}`,
      ].join('\n'),
    });
  }

  if (analysis.databaseBottlenecks.slowQueryCount > 0) {
    const savings = Math.round(
      analysis.databaseBottlenecks.estimatedWasteUsd * DB_N1_SAVINGS_SHARE * scale,
    );
    fixes.push({
      id: 'DB_N1_BATCH',
      title: 'Batch N+1 queries into single IN (...) round-trips',
      category: 'database',
      targetPath: 'src/data/orders.ts',
      monthlySavingsUsd: savings,
      estimatedEffortHours: DB_N1_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, DB_N1_EFFORT_HOURS),
      description:
        'One query per parent row (N+1 pattern) fans out on identical tables. Batch fetch with a single IN clause or a DataLoader keyed on the parent ids cuts round-trips from N+1 to 2.',
      suggestedCodeDiff: [
        `// DataLoader(orders.ts) bunches sibling queries into one fetch:`,
        `import DataLoader from 'dataloader';`,
        `const orderItemsLoader = new DataLoader((orderIds: number[]) =>`,
        `  db.select().from(orderItems)`,
        `     .where(inArray(orderItems.orderId, orderIds))`,
        `);`,
        ``,
        `// raw SQL equivalent:`,
        `-- SELECT * FROM order_items WHERE order_id IN (?, ?, ...);`,
      ].join('\n'),
    });
  }

  return fixes;
}