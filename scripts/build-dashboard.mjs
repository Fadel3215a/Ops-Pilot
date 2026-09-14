import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, 'dist', 'dashboard');
const SRC_DIR = join(ROOT, 'src', 'ui', 'dashboard');

async function main() {
  await mkdir(DIST_DIR, { recursive: true });

  await build({
    entryPoints: [join(SRC_DIR, 'main.ts')],
    bundle: true,
    outfile: join(DIST_DIR, 'ui.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: false,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: 'var process = { env: {} };' },
    logLevel: 'info',
  });

  await Promise.all([
    copyFile(join(SRC_DIR, 'index.html'), join(DIST_DIR, 'index.html')),
    copyFile(join(SRC_DIR, 'styles.css'), join(DIST_DIR, 'styles.css')),
  ]);
}

main().catch((err) => {
  console.error('Dashboard build failed:', err);
  process.exitCode = 1;
});