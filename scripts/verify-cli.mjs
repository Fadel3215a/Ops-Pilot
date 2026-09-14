import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const ROOT = process.cwd();
const BIN = join(ROOT, 'dist', 'opspilot.cjs');

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

function runNode(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

async function main() {
  const build = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts', 'build-cli.mjs')],
    { cwd: ROOT, encoding: 'utf8', timeout: 120_000 },
  );
  check('CLI bundle builds via esbuild', build.status === 0, `code=${build.status}`);

  let stats;
  try {
    stats = await stat(BIN);
  } catch {
    check('dist/opspilot.cjs exists', false, 'missing after build');
  }
  if (stats) {
    check('dist/opspilot.cjs is non-empty', stats.size > 0, `${stats.size} bytes`);
  }

  const contents = await readFile(BIN, 'utf8');
  check('bundle starts with shebang', contents.startsWith('#!/usr/bin/env node'));

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  check(
    'package.json bin maps to dist/opspilot.cjs',
    (pkg.bin?.opspilot ?? '') === './dist/opspilot.cjs',
    JSON.stringify(pkg.bin?.opspilot),
  );

  const version = runNode(['--version']);
  check('--version exits 0', version.status === 0, `code=${version.status}`);
  check('--version prints opspilot 1.0.0', version.stdout.includes('opspilot 1.0.0'), version.stdout.trim());

  const help = runNode(['--help']);
  check('--help exits 0', help.status === 0, `code=${help.status}`);
  check('--help prints usage', help.stdout.includes('Usage: opspilot <command>'), help.stdout.split('\n')[0]);

  const bogus = runNode(['--bogus']);
  check('unknown command exits 1', bogus.status === 1, `code=${bogus.status}`);

  const audit = runNode(['audit', '--target=https://store.example.com/', '--dry-run']);
  check('audit --dry-run exits 0', audit.status === 0, `code=${audit.status}`);
  check('audit prints formatted summary', audit.stdout.includes('OpsPilot Audit') && audit.stdout.includes('combined loss'), audit.stdout.trim().split('\n')[0] ?? '');

  console.log(failed === 0 ? '\nVERIFY CLI OK' : `\nVERIFY CLI FAILED (${failed})`);
  process.exitCode = failed > 0 ? 1 : 0;
  process.exit();
}

main().catch((err) => {
  console.error('VERIFY CLI FAILED:', err?.message ?? err);
  process.exitCode = 1;
  process.exit();
});