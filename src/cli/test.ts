import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearHistory, syntheticScanResult } from '../watchdog';
import { parseCliArgs, USAGE, VERSION } from './args';
import { main } from './index';

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

function parseThrows(argv: readonly string[], fragment: string): boolean {
  try {
    parseCliArgs(argv);
    return false;
  } catch (error) {
    return String(error).includes(fragment);
  }
}

interface WebhookCall {
  url: string;
  method: string;
}

function mockGitHubFetch(calls: WebhookCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });

    let payload: unknown;
    let status = 200;
    if (url.includes('/git/ref/heads/')) {
      payload = { object: { sha: 'base-sha' } };
    } else if (url.includes('/git/refs') && method === 'POST') {
      payload = { ref: url.split('/').pop(), object: { sha: 'created-base-sha' } };
      status = 201;
    } else if (url.includes('/git/trees')) {
      payload = { sha: 'tree-sha' };
      status = 201;
    } else if (url.includes('/git/commits')) {
      payload = { sha: 'commit-sha' };
      status = 201;
    } else if (url.endsWith('/pulls')) {
      payload = {
        number: 12,
        html_url: 'https://github.com/acme/storefront/pull/12',
      };
      status = 201;
    } else if (url.includes('/git/refs/')) {
      payload = { ref: 'refs/heads/x', object: { sha: 'commit-sha' } };
    }
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

const TEMP_HISTORY = path.join(os.tmpdir(), 'watchdog-cli.test.json');

async function withTempHistory<T>(fn: (file: string) => Promise<T>): Promise<T> {
  await clearHistory(TEMP_HISTORY);
  try {
    return await fn(TEMP_HISTORY);
  } finally {
    await rm(TEMP_HISTORY, { force: true });
  }
}

async function mainWithoutEnvToken(
  argv: readonly string[],
  deps: Parameters<typeof main>[1] = {},
): Promise<number> {
  const previous = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    return await main(argv, deps);
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
  }
}

async function mainTest(): Promise<void> {
  await run('parse: audit accepts --target and applies defaults', () => {
    const parsed = parseCliArgs(['audit', '--target=https://store.example.com/']);
    assert.strictEqual(parsed.command, 'audit');
    assert.strictEqual(parsed.url, 'https://store.example.com/');
    assert.strictEqual(parsed.intervalMinutes, 15);
    assert.strictEqual(parsed.once, false);
    assert.strictEqual(parsed.dryRun, false);
  });

  await run('parse: --url is an alias for --target', () => {
    const parsed = parseCliArgs(['watch', '--url=https://store.example.com/']);
    assert.strictEqual(parsed.url, 'https://store.example.com/');
  });

  await run('parse: conflicting --url and --target rejected', () => {
    assert.ok(
      parseThrows(
        ['audit', '--url=https://a/', '--target=https://b/'],
        'not both',
      ),
    );
  });

  await run('parse: --interval override and validation', () => {
    assert.strictEqual(
      parseCliArgs(['watch', '--target=https://x', '--interval=30'])
        .intervalMinutes,
      30,
    );
    assert.ok(
      parseThrows(['watch', '--target=https://x', '--interval=abc'], 'Invalid'),
    );
    assert.ok(
      parseThrows(['watch', '--target=https://x', '--interval=0'], 'Invalid'),
    );
  });

  await run('parse: --once and --dry-run flags', () => {
    const parsed = parseCliArgs([
      'watch',
      '--target=https://x',
      '--once',
      '--dry-run',
    ]);
    assert.strictEqual(parsed.once, true);
    assert.strictEqual(parsed.dryRun, true);
  });

  await run('parse: --webhook and --logs', () => {
    const parsed = parseCliArgs([
      'watch',
      '--target=https://x',
      '--webhook=https://hooks.example.com',
      '--logs=./logs.json',
    ]);
    assert.strictEqual(parsed.webhookUrl, 'https://hooks.example.com');
    assert.strictEqual(parsed.logsPath, './logs.json');
  });

  await run('parse: --repo accepted when owner/name', () => {
    const parsed = parseCliArgs([
      'patch',
      '--target=https://x',
      '--repo=acme/storefront',
    ]);
    assert.strictEqual(parsed.repo, 'acme/storefront');
  });

  await run('parse: malformed --repo rejected', () => {
    assert.ok(parseThrows(['patch', '--target=https://x', '--repo=acme'], 'Invalid --repo'));
    assert.ok(
      parseThrows(['patch', '--target=https://x', '--repo=a/b/c'], 'Invalid --repo'),
    );
  });

  await run('parse: --version and --help resolve', () => {
    assert.strictEqual(parseCliArgs(['--version']).command, 'version');
    assert.strictEqual(parseCliArgs(['--help']).command, 'help');
    assert.strictEqual(parseCliArgs(['audit', '--help']).command, 'help');
    assert.strictEqual(parseCliArgs([]).command, 'help');
  });

  await run('parse: unknown option rejected', () => {
    assert.ok(parseThrows(['audit', '--target=https://x', '--bogus'], 'Unknown option'));
  });

  await run('parse: unknown positional rejected', () => {
    assert.ok(parseThrows(['frobnicate'], 'Unknown argument'));
  });

  await run('parse: audit and watch require a target', () => {
    assert.ok(parseThrows(['audit'], 'Missing required'));
    assert.ok(parseThrows(['watch'], 'Missing required'));
    assert.ok(parseThrows(['patch'], 'Missing required'));
  });

  await run('main: --version exits 0 and prints the version', async () => {
    assert.strictEqual(await main(['--version']), 0);
    const parsed = parseCliArgs(['--version']);
    assert.strictEqual(parsed.command, 'version');
  });

  await run('main: --help exits 0 and prints usage', async () => {
    assert.strictEqual(await main(['--help']), 0);
    assert.ok(USAGE.includes('Usage: opspilot <command>'));
    assert.strictEqual(VERSION, '1.0.0');
  });

  await run('main: unknown command exits 1', async () => {
    assert.strictEqual(await main(['bogus']), 1);
  });

  await run('main: audit without target exits 1', async () => {
    assert.strictEqual(await main(['audit']), 1);
  });

  await run('main: audit dry-run exits 0', async () => {
    const code = await main(
      ['audit', '--target=https://store.example.com/', '--dry-run'],
      { scan: syntheticScanResult },
    );
    assert.strictEqual(code, 0);
  });

  await run('main: patch without repo prints plan and exits 0', async () => {
    const code = await main(
      ['patch', '--target=https://store.example.com/', '--dry-run'],
      { scan: syntheticScanResult },
    );
    assert.strictEqual(code, 0);
  });

  await run('main: patch --repo dry-run exits 0 without network', async () => {
    const code = await main(
      [
        'patch',
        '--target=https://store.example.com/',
        '--dry-run',
        '--repo=acme/storefront',
      ],
      { scan: syntheticScanResult },
    );
    assert.strictEqual(code, 0);
  });

  await run('main: patch --repo without token exits 1', async () => {
    const code = await mainWithoutEnvToken(
      ['patch', '--target=https://store.example.com/', '--repo=acme/storefront'],
      { scan: syntheticScanResult },
    );
    assert.strictEqual(code, 1);
  });

  await run('main: patch --repo with token opens a PR through fetch', async () => {
    const calls: WebhookCall[] = [];
    const code = await main(
      ['patch', '--target=https://store.example.com/', '--repo=acme/storefront'],
      { scan: syntheticScanResult, token: 'test-token', fetchFn: mockGitHubFetch(calls) },
    );
    assert.strictEqual(code, 0);
    const prCalls = calls.filter((call) => call.url.endsWith('/pulls'));
    assert.strictEqual(prCalls.length, 1, 'pull request created');
    assert.strictEqual(calls.length, 6, 'full PR pipeline exercised');
  });

  await run('main: watch --once dry-run exits 0', async () => {
    await withTempHistory(async (file) => {
      const code = await main(
        ['watch', '--target=https://store.example.com/', '--once', '--dry-run'],
        { scan: syntheticScanResult, historyPath: file },
      );
      assert.strictEqual(code, 0);
    });
  });

  await run('main: watch without target exits 1', async () => {
    assert.strictEqual(await main(['watch']), 1);
  });

  console.log(`\nOpsPilot CLI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

mainTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});