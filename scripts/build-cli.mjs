import { build } from 'esbuild';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUTFILE = join(ROOT, 'dist', 'opspilot.cjs');

const BOOTSTRAP = [
  'if (require.main === module) {',
  '  main(process.argv.slice(2))',
  '    .then(function (code) { process.exitCode = code; })',
  '    .catch(function (error) { console.error(error); process.exitCode = 1; });',
  '}',
  '',
].join('\n');

async function main() {
  await build({
    entryPoints: [join(ROOT, 'src', 'cli', 'index.ts')],
    outfile: OUTFILE,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    minify: false,
    sourcemap: false,
    banner: { js: '#!/usr/bin/env node' },
    footer: { js: BOOTSTRAP },
    external: ['playwright', 'typescript5'],
    logLevel: 'info',
  });
  console.log(`Built ${OUTFILE}`);
}

main().catch((err) => {
  console.error('CLI build failed:', err);
  process.exitCode = 1;
});