import type { LossAnalysis } from '../engine/types';
import { computeRoiScore } from './planner';
import type { ActionableFix } from './types';

export const LCP_SAVINGS_SHARE = 0.6;
export const LCP_EFFORT_HOURS = 4;
export const SCRIPT_DEFER_SAVINGS_SHARE = 0.35;
export const SCRIPT_DEFER_EFFORT_HOURS = 2;
export const SECURITY_HEADERS_SAVINGS_SHARE = 1.0;
export const SECURITY_HEADERS_EFFORT_HOURS = 6;

export function generateFrontendFixes(loss: LossAnalysis): ActionableFix[] {
  const fixes: ActionableFix[] = [];
  const { breakdown, metrics } = loss;

  if (breakdown.latencyLossUsd > 0 && metrics.lcpPenaltyPercent > 0) {
    const savings = Math.round(breakdown.latencyLossUsd * LCP_SAVINGS_SHARE);
    fixes.push({
      id: 'LCP_IMAGE_PRELOAD',
      title: 'Preload hero image with high fetch priority',
      category: 'performance',
      targetPath: 'src/app/page.tsx',
      monthlySavingsUsd: savings,
      estimatedEffortHours: LCP_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, LCP_EFFORT_HOURS),
      description:
        'The largest contentful paint element (hero image) is discovered late. Preload it so layout can begin painting the LCP element before the HTML is fully parsed.',
      suggestedCodeDiff: [
        `<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />`,
        ``,
        `// Next.js App Router equivalent — first image on the route:`,
        `<Image priority src="/hero.webp" fill sizes="100vw" alt="Hero" />`,
      ].join('\n'),
    });
  }

  if (breakdown.bloatLossUsd > 0) {
    const savings = Math.round(breakdown.bloatLossUsd * SCRIPT_DEFER_SAVINGS_SHARE);
    fixes.push({
      id: 'SCRIPT_DEFER',
      title: 'Defer third-party render-blocking scripts',
      category: 'performance',
      targetPath: 'src/app/layout.tsx',
      monthlySavingsUsd: savings,
      estimatedEffortHours: SCRIPT_DEFER_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, SCRIPT_DEFER_EFFORT_HOURS),
      description:
        'Third-party scripts block main-thread work during parse. Loading them with defer preserves execution order after DOM parsing; async applies to independent trackers.',
      suggestedCodeDiff: [
        `// Depend on DOM order — parse-blocking today, defer keeps order:`,
        `<script defer src="https://cdn.example.com/widget.js"></script>`,
        ``,
        `// Independent analytics — fully async:`,
        `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>`,
      ].join('\n'),
    });
  }

  if (breakdown.securityRiskUsd > 0) {
    const savings = Math.round(breakdown.securityRiskUsd * SECURITY_HEADERS_SAVINGS_SHARE);
    fixes.push({
      id: 'SECURITY_HEADERS',
      title: 'Emit HSTS, CSP and X-Content-Type-Options headers',
      category: 'security',
      targetPath: 'next.config.ts',
      monthlySavingsUsd: savings,
      estimatedEffortHours: SECURITY_HEADERS_EFFORT_HOURS,
      roiScore: computeRoiScore(savings, SECURITY_HEADERS_EFFORT_HOURS),
      description:
        'The storefront serves without security headers, raising the risk tax. HSTS forces TLS upgrades, CSP constrains injection surface, and X-Content-Type-Options blocks MIME-sniffing.',
      suggestedCodeDiff: [
        `// next.config.ts`,
        `const nextConfig = {`,
        `  async headers() {`,
        `    return [{`,
        `      source: '/(.*)',`,
        `      headers: [`,
        `        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },`,
        `        { key: 'Content-Security-Policy',`,
        `          value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'" },`,
        `        { key: 'X-Content-Type-Options', value: 'nosniff' },`,
        `      ],`,
        `    }];`,
        `  },`,
        `};`,
        `export default nextConfig;`,
      ].join('\n'),
    });
  }

  return fixes;
}