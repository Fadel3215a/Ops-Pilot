import assert from 'node:assert';
import type { ActionableFix } from '../../remediation/types';
import { createUnifiedDiff } from './diff';
import { generatePatchForFix } from './index';
import { hasSyntaxError } from './internal';
import {
  transformLcpPreload,
  LCP_PRELOAD_LINK,
} from './transformers/lcpPreload';
import { transformScriptDefer } from './transformers/scriptDefer';
import { transformSecurityHeaders } from './transformers/securityHeaders';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${String(error).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const IMAGE_SAMPLE = [
  `import Image from 'next/image';`,
  ``,
  `export default function Home() {`,
  `  return (`,
  `    <main>`,
  `      <Image src="/hero.webp" width={1600} height={900} alt="Hero" />`,
  `    </main>`,
  `  );`,
  `}`,
].join('\n');

const IMG_SAMPLE = [
  `export default function Hero() {`,
  `  return <img src="/hero.webp" alt="Hero" />;`,
  `}`,
].join('\n');

const HEADLESS_SAMPLE = [
  `export default function Page() {`,
  `  return <h1>No hero</h1>;`,
  `}`,
].join('\n');

const SCRIPT_SAMPLE = [
  `export default function RootLayout({ children }) {`,
  `  return (`,
  `    <html lang="en">`,
  `      <body>`,
  `        {children}`,
  `        <script src="https://cdn.example.com/widget.js" defer />`,
  `        <script src="https://analytics.example.net/t.js" async />`,
  `        <script src="/_next/static/chunks/wc.js" />`,
  `        <script src="https://ads.example.com/ad.js" />`,
  `      </body>`,
  `    </html>`,
  `  );`,
  `}`,
].join('\n');

const CONFIG_SAMPLE = [
  `const nextConfig = {`,
  `  reactStrictMode: true,`,
  `};`,
  ``,
  `export default nextConfig;`,
].join('\n');

const CONFIG_DEFAULT_SAMPLE = [`export default {`, `  poweredByHeader: false,`, `};`].join('\n');

const MODULE_EXPORTS_SAMPLE = `module.exports = {\n  cleanUrls: true\n};\n`;
const FALLBACK_SAMPLE = `export const siteName = 'storefront';\n`;

function fix(
  id: ActionableFix['id'],
  targetPath: string,
  monthlySavingsUsd = 700,
): ActionableFix {
  return {
    id,
    targetPath,
    title: 't',
    category: 'performance',
    monthlySavingsUsd,
    estimatedEffortHours: 2,
    roiScore: 100,
    description: 's',
    suggestedCodeDiff: '-b\n+a',
  };
}

check('SSR sequential awaits / synthetic actionable fix', () => {
  const urn = generatePatchForFix(fix('LCP_IMAGE_PRELOAD', 'src/app/page.tsx'));
  assert.strictEqual(urn.fixId, 'LCP_IMAGE_PRELOAD');
  assert.ok(urn.patchedContent.includes('<Image priority'));
  assert.ok(urn.originalContent !== urn.patchedContent);
});

check('LCP: injects priority onto Next Image', () => {
  const out = transformLcpPreload(IMAGE_SAMPLE, 'src/app/page.tsx');
  assert.ok(out.includes('<Image priority src="/hero.webp"'));
  assert.ok(!hasSyntaxError(out, 'src/app/page.tsx'));
});

check('LCP: injects fetchpriority="high" onto plain img', () => {
  const out = transformLcpPreload(IMG_SAMPLE, 'src/app/page.tsx');
  assert.ok(out.includes('<img fetchpriority="high" src="/hero.webp"'));
  assert.ok(!hasSyntaxError(out, 'src/app/page.tsx'));
});

check('LCP: idempotent when priority already present', () => {
  const decorated = transformLcpPreload(IMAGE_SAMPLE, 'src/app/page.tsx');
  assert.strictEqual(transformLcpPreload(decorated, 'src/app/page.tsx'), decorated);
});

check('LCP: falls back to injecting preload link on headless pages', () => {
  const out = transformLcpPreload(HEADLESS_SAMPLE, 'src/app/page.tsx');
  assert.ok(out.includes(LCP_PRELOAD_LINK));
  assert.ok(!hasSyntaxError(out, 'src/app/page.tsx'));
});

check('SCRIPT_DEFER: keeps flagged scripts untouched', () => {
  const out = transformScriptDefer(SCRIPT_SAMPLE, 'src/app/layout.tsx');
  assert.ok(out.includes('cdn.example.com/widget.js" defer'));
  assert.ok(out.includes('analytics.example.net/t.js" async'));
});

check('SCRIPT_DEFER: defers internal bundle, asyncs third-party', () => {
  const out = transformScriptDefer(SCRIPT_SAMPLE, 'src/app/layout.tsx');
  assert.ok(out.includes('<script defer src="/_next/static/chunks/wc.js"'));
  assert.ok(out.includes('<script async src="https://ads.example.com/ad.js"'));
  assert.ok(!hasSyntaxError(out, 'src/app/layout.tsx'));
});

check('SCRIPT_DEFER: no-op when nothing lacks a flag', () => {
  const clean = `<script src="https://cdn.example.com/widget.js" async />`;
  assert.strictEqual(transformScriptDefer(clean, 'src/app/layout.tsx'), clean);
});

check('SECURITY_HEADERS: injects async headers() into nextConfig', () => {
  const out = transformSecurityHeaders(CONFIG_SAMPLE, 'next.config.ts');
  assert.ok(out.includes('async headers()'));
  assert.ok(out.includes("'Strict-Transport-Security'"));
  assert.ok(out.includes("'Content-Security-Policy'"));
  assert.ok(out.includes("'X-Content-Type-Options'"));
  assert.ok(!hasSyntaxError(out, 'next.config.ts'));
});

check('SECURITY_HEADERS: supports export default object', () => {
  const out = transformSecurityHeaders(CONFIG_DEFAULT_SAMPLE, 'next.config.ts');
  assert.ok(out.includes('async headers()'));
  assert.ok(!hasSyntaxError(out, 'next.config.ts'));
});

check('SECURITY_HEADERS: supports module.exports object', () => {
  const out = transformSecurityHeaders(MODULE_EXPORTS_SAMPLE, 'next.config.js');
  assert.ok(out.includes('async headers()'));
  assert.ok(!hasSyntaxError(out, 'next.config.js'));
});

check('SECURITY_HEADERS: appends config when no object is found', () => {
  const out = transformSecurityHeaders(FALLBACK_SAMPLE, 'next.config.ts');
  assert.ok(out.includes('const nextConfig = {'));
  assert.ok(out.includes('async headers()'));
  assert.ok(!hasSyntaxError(out, 'next.config.ts'));
});

check('SECURITY_HEADERS: idempotent on second run', () => {
  const once = transformSecurityHeaders(CONFIG_SAMPLE, 'next.config.ts');
  const twice = transformSecurityHeaders(once, 'next.config.ts');
  assert.strictEqual(twice, once);
});

check('DIFF: emits git-style headers and hunks', () => {
  const diff = createUnifiedDiff('src/app/page.tsx', 'a\nb\nc\n', 'a\nB\nc\n');
  assert.ok(diff.startsWith('--- a/src/app/page.tsx\n+++ b/src/app/page.tsx\n'));
  assert.match(diff, /@@ -1,3 \+1,3 @@/);
  assert.ok(diff.includes(' a'));
  assert.ok(diff.includes(' c'));
  assert.ok(diff.includes('-b'));
  assert.ok(diff.includes('+B'));
});

check('DIFF: empty diff for identical content', () => {
  assert.strictEqual(createUnifiedDiff('x', 'one\ntwo\n', 'one\ntwo\n'), '');
});

check('DIFF: insertion-only change produces +1 count', () => {
  const diff = createUnifiedDiff('next.config.ts', 'a\n', 'a\nb\n');
  assert.match(diff, /@@ -1[,0-9]* \+1,2 @@/);
  assert.ok(diff.includes('+b'));
});

check('generatePatchForFix: builds full GeneratedPatch from defaults', () => {
  const patch = generatePatchForFix(
    fix('SECURITY_HEADERS', 'next.config.ts'),
  );
  assert.strictEqual(patch.fixId, 'SECURITY_HEADERS');
  assert.ok(patch.unifiedDiff.length > 0);
  assert.ok(patch.originalContent.includes('nextConfig'));
  assert.ok(patch.patchedContent.includes('async headers()'));
  assert.strictEqual(patch.hasSyntaxError, false);
  assert.ok(patch.unifiedDiff.startsWith('--- a/next.config.ts'));
});

check('generatePatchForFix: accepts explicit targetSource override', () => {
  const patch = generatePatchForFix(
    fix('SCRIPT_DEFER', 'src/app/layout.tsx'),
    `<script src="https://cdn.example.com/widget.js" />`,
  );
  assert.ok(patch.patchedContent.includes('async'));
  assert.strictEqual(patch.hasSyntaxError, false);
});

check('generatePatchForFix: backend-only fixes produce a no-op patch', () => {
  const patch = generatePatchForFix(
    fix('DB_N1_BATCH', 'src/lib/db/orderItems.ts'),
  );
  assert.strictEqual(patch.originalContent, patch.patchedContent);
  assert.strictEqual(patch.unifiedDiff, '');
  assert.strictEqual(patch.hasSyntaxError, false);
});

check('patched ASTs are syntactically valid end-to-end', () => {
  for (const id of [
    'LCP_IMAGE_PRELOAD',
    'SCRIPT_DEFER',
    'SECURITY_HEADERS',
  ] as const) {
    const patch = generatePatchForFix(fix(id, 'synthetic.tsx'));
    assert.strictEqual(
      patch.hasSyntaxError,
      false,
      `${id} patched source must re-parse cleanly`,
    );
  }
});

check('generated patch with altered source still parses after apply', () => {
  const patch = generatePatchForFix(
    fix('SECURITY_HEADERS', 'next.config.ts'),
    CONFIG_SAMPLE,
  );
  assert.ok(!hasSyntaxError(patch.patchedContent, 'next.config.ts'));
  assert.ok(patch.unifiedDiff.includes('async headers()'));
  assert.ok(patch.unifiedDiff.includes('--- a/next.config.ts'));
});

console.log(`\nAST patch generator: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;