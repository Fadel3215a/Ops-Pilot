import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const UI_DIR = join(ROOT, 'src', 'ui');

async function main() {
  await mkdir(DIST, { recursive: true });

  await build({
    entryPoints: [join(UI_DIR, 'main.ts')],
    bundle: true,
    outfile: join(DIST, 'ui.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: false,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });

  await Promise.all([
    copyFile(join(UI_DIR, 'index.html'), join(DIST, 'index.html')),
    copyFile(join(UI_DIR, 'styles.css'), join(DIST, 'styles.css')),
  ]);
}

main().catch((err) => {
  console.error('UI build failed:', err);
  process.exitCode = 1;
});