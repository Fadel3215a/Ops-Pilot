import type { ActionableFix } from '../../remediation/types';
import { createUnifiedDiff } from './diff';
import { hasSyntaxError } from './internal';
import { transformLcpPreload } from './transformers/lcpPreload';
import { transformScriptDefer } from './transformers/scriptDefer';
import { transformSecurityHeaders } from './transformers/securityHeaders';
import type { GeneratedPatch } from './types';

const DEFAULT_SAMPLES: Partial<Record<string, string>> = {
  LCP_IMAGE_PRELOAD: [
    `import Image from 'next/image';`,
    ``,
    `export default function Home() {`,
    `  return (`,
    `    <main>`,
    `      <Image src="/hero.webp" width={1600} height={900} alt="Hero" />`,
    `      <p>Welcome</p>`,
    `    </main>`,
    `  );`,
    `}`,
  ].join('\n'),
  SCRIPT_DEFER: [
    `export default function RootLayout({ children }) {`,
    `  return (`,
    `    <html lang="en">`,
    `      <body>`,
    `        {children}`,
    `        <script src="https://cdn.example.com/widget.js" />`,
    `        <script src="/_next/static/chunks/wc.js" />`,
    `      </body>`,
    `    </html>`,
    `  );`,
    `}`,
  ].join('\n'),
  SECURITY_HEADERS: [
    `const nextConfig = {`,
    `  reactStrictMode: true,`,
    `};`,
    ``,
    `export default nextConfig;`,
  ].join('\n'),
};

export function generatePatchForFix(
  fix: ActionableFix,
  targetSource?: string,
): GeneratedPatch {
  const original = targetSource ?? DEFAULT_SAMPLES[fix.id] ?? '';

  let patched = original;
  switch (fix.id) {
    case 'LCP_IMAGE_PRELOAD':
      patched = transformLcpPreload(original, fix.targetPath);
      break;
    case 'SCRIPT_DEFER':
      patched = transformScriptDefer(original, fix.targetPath);
      break;
    case 'SECURITY_HEADERS':
      patched = transformSecurityHeaders(original, fix.targetPath);
      break;
  }

  return {
    fixId: fix.id,
    targetPath: fix.targetPath,
    originalContent: original,
    patchedContent: patched,
    unifiedDiff: createUnifiedDiff(fix.targetPath, original, patched),
    hasSyntaxError: hasSyntaxError(patched, fix.targetPath),
  };
}

export { createUnifiedDiff } from './diff';
export { hasSyntaxError } from './internal';
export { transformLcpPreload } from './transformers/lcpPreload';
export { transformScriptDefer } from './transformers/scriptDefer';
export { transformSecurityHeaders } from './transformers/securityHeaders';