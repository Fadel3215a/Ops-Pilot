import assert from 'node:assert';
import type { GeneratedPatch } from '../ast/types';
import { generatePatchForFix } from '../ast';
import type { ActionableFix } from '../../remediation/types';
import { GitHubClient } from './client';
import { createRemediationPR, deriveBranchName } from './automator';

let passed = 0;
let failed = 0;

function log(name: string, error: unknown): void {
  if (error === undefined) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(
      `      ${String(error).split('\n').slice(0, 4).join('\n      ')}`,
    );
  }
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    log(name, undefined);
  } catch (error) {
    log(name, error);
  }
}

function fix(id: ActionableFix['id'], targetPath: string): ActionableFix {
  return {
    id,
    targetPath,
    category: 'performance',
    title: 't',
    monthlySavingsUsd: 700,
    estimatedEffortHours: 2,
    roiScore: 1,
    description: 'd',
    suggestedCodeDiff: '',
  };
}

function makePatch(id: ActionableFix['id'], targetPath: string): GeneratedPatch {
  return generatePatchForFix(fix(id, targetPath));
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockRespond(url: string, method: string): object {
  if (url.includes('/git/ref/heads/')) {
    return { ref: 'refs/heads/main', object: { sha: 'base-sha-123' } };
  }
  if (url.includes('/git/refs') && method === 'POST') {
    return { ref: 'refs/heads/opspilot/test', object: { sha: 'base-sha-123' } };
  }
  if (url.includes('/git/trees')) {
    return { sha: 'tree-sha-456' };
  }
  if (url.includes('/git/commits')) {
    return { sha: 'commit-sha-789' };
  }
  if (url.includes('/git/refs') && method === 'PATCH') {
    return { ref: 'refs/heads/opspilot/test', object: { sha: 'commit-sha-789' } };
  }
  if (url.includes('/pulls')) {
    return { number: 303, html_url: 'https://github.com/acme/storefront/pull/303' };
  }
  return {};
}

interface MockInstall {
  calls: RecordedCall[];
  restore(): void;
}

function installMockFetch(): MockInstall {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }
    const body =
      init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, headers, body });
    return new Response(JSON.stringify(mockRespond(url, method)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

(async () => {
  await run('branch name: single fix id maps to fix-<kebab-id>', () => {
    assert.strictEqual(
      deriveBranchName([makePatch('LCP_IMAGE_PRELOAD', 'src/app/page.tsx')]),
      'opspilot/fix-lcp-preload',
    );
  });

  await run('branch name: multiple fix ids collapse to batch-1', () => {
    const patches = [
      makePatch('SCRIPT_DEFER', 'src/app/layout.tsx'),
      makePatch('SECURITY_HEADERS', 'next.config.ts'),
    ];
    assert.strictEqual(
      deriveBranchName(patches),
      'opspilot/remediation-batch-1',
    );
  });

  await run('client dry-run: deterministic shas and fabricated PR', async () => {
    const client = new GitHubClient({ token: 't', dryRun: true });
    assert.strictEqual(await client.getRef('o', 'r', 'main'), 'dryrun-base-sha');
    assert.strictEqual(await client.createTree('o', 'r', 'base', []), 'dryrun-tree-0');
    assert.strictEqual(
      await client.createCommit('o', 'r', 'm', 'tree', ['p']),
      'dryrun-commit-sha',
    );
    const pr = await client.createPullRequest('o', 'r', {
      title: 't',
      head: 'b',
      base: 'main',
      body: 'b',
    });
    assert.strictEqual(pr.number, 303);
    assert.strictEqual(pr.html_url, 'https://github.com/o/r/pull/303');
  });

  await run('dry-run end-to-end emits zero network calls', async () => {
    const { calls, restore } = installMockFetch();
    try {
      const result = await createRemediationPR(
        [makePatch('LCP_IMAGE_PRELOAD', 'src/app/page.tsx')],
        { owner: 'acme', repo: 'storefront', token: 'tok_abc' },
        { dryRun: true },
      );
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(result.status, 'dry-run');
      assert.strictEqual(result.branchName, 'opspilot/fix-lcp-preload');
      assert.strictEqual(result.prNumber, 303);
    } finally {
      restore();
    }
  });

  await run('createRemediationPR drives the full REST pipeline', async () => {
    const { calls, restore } = installMockFetch();
    try {
      const result = await createRemediationPR(
        [
          makePatch('SCRIPT_DEFER', 'src/app/layout.tsx'),
          makePatch('SECURITY_HEADERS', 'next.config.ts'),
        ],
        {
          owner: 'acme',
          repo: 'storefront',
          token: 'tok_abc',
          baseBranch: 'main',
        },
      );

      assert.strictEqual(result.status, 'created');
      assert.strictEqual(result.branchName, 'opspilot/remediation-batch-1');
      assert.strictEqual(result.prNumber, 303);
      assert.strictEqual(
        result.prUrl,
        'https://github.com/acme/storefront/pull/303',
      );

      const urls = calls.map((c) => c.url);
      assert.ok(urls.some((u) => u.endsWith('/git/ref/heads/main')));
      assert.ok(
        urls.some(
          (u, i) => u.endsWith('/git/refs') && urls[i] === u && calls[i].method === 'POST',
        ),
      );
      assert.ok(urls.some((u) => u.endsWith('/git/trees')));
      assert.ok(urls.some((u) => u.endsWith('/git/commits')));
      assert.ok(
        urls.some(
          (u, i) => u.includes('/git/refs/refs/heads/') && calls[i].method === 'PATCH',
        ),
      );
      assert.ok(urls.some((u) => u.endsWith('/pulls')));

      for (const call of calls) {
        assert.strictEqual(call.headers['authorization'], 'Bearer tok_abc');
        assert.strictEqual(call.headers['accept'], 'application/vnd.github+json');
      }

      const createRef = calls.find((c) => c.url.endsWith('/git/refs') && c.method === 'POST');
      assert.deepStrictEqual(createRef?.body, {
        ref: 'refs/heads/opspilot/remediation-batch-1',
        sha: 'base-sha-123',
      });

      const commitCall = calls.find((c) => c.url.endsWith('/git/commits'));
      const commitBody = commitCall?.body as { parents: string[]; tree: string };
      assert.deepStrictEqual(commitBody.parents, ['base-sha-123']);
      assert.strictEqual(commitBody.tree, 'tree-sha-456');

      const treeCall = calls.find((c) => c.url.endsWith('/git/trees'));
      const treeBody = treeCall?.body as {
        base_tree: string;
        tree: Array<{ path: string; content: string }>;
      };
      assert.strictEqual(treeBody.base_tree, 'base-sha-123');
      assert.deepStrictEqual(
        treeBody.tree.map((item) => item.path),
        ['src/app/layout.tsx', 'next.config.ts'],
      );
      assert.ok(treeBody.tree.every((item) => item.content.length > 0));

      const prCall = calls.find((c) => c.url.endsWith('/pulls'));
      const prBody = prCall?.body as {
        head: string;
        base: string;
        title: string;
        body: string;
      };
      assert.strictEqual(prBody.head, 'opspilot/remediation-batch-1');
      assert.strictEqual(prBody.base, 'main');
      assert.match(prBody.title, /^fix: apply opspilot\/remediation-batch-1 remediation$/);
      assert.ok(prBody.body.includes('Estimated savings'));
      assert.ok(prBody.body.includes('$3,136/mo'));
      assert.ok(prBody.body.includes('Estimated effort'));
      assert.ok(prBody.body.includes('5 hour(s)'));
      assert.ok(prBody.body.includes('src/app/layout.tsx'));
      assert.ok(prBody.body.includes('next.config.ts'));
      assert.ok(prBody.body.includes('diff'));
      assert.ok(prBody.body.includes('async headers()'));
    } finally {
      restore();
    }
  });

  await run('createRemediationPR honors a custom base branch', async () => {
    const { calls, restore } = installMockFetch();
    try {
      const result = await createRemediationPR(
        [makePatch('LCP_IMAGE_PRELOAD', 'src/app/page.tsx')],
        {
          owner: 'acme',
          repo: 'storefront',
          token: 'tok_abc',
          baseBranch: 'develop',
        },
      );
      assert.strictEqual(result.branchName, 'opspilot/fix-lcp-preload');
      assert.ok(calls.some((c) => c.url.endsWith('/git/ref/heads/develop')));
      const prCall = calls.find((c) => c.url.endsWith('/pulls'));
      assert.strictEqual((prCall?.body as { base: string }).base, 'develop');
    } finally {
      restore();
    }
  });

  await run('createRemediationPR rejects all-noop patches', async () => {
    const noopPatch: GeneratedPatch = {
      fixId: 'DB_N1_BATCH',
      targetPath: 'src/lib/db/orderItems.ts',
      originalContent: '',
      patchedContent: '',
      unifiedDiff: '',
      hasSyntaxError: false,
    };
    let threw = false;
    try {
      await createRemediationPR(
        [noopPatch],
        { owner: 'acme', repo: 'storefront', token: 'tok_abc' },
        { dryRun: true },
      );
    } catch (error) {
      threw = /No changed files/.test(String(error));
    }
    assert.ok(threw, 'expected a "No changed files" error');
  });

  console.log(`\nGitHub PR automator: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();