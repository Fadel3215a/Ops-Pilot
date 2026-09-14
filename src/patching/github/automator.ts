import type { GeneratedPatch } from '../ast/types';
import { GitHubClient } from './client';
import type { PRConfig, PRResult, TreeItem } from './types';

interface FixMeta {
  savingsUsd: number;
  effortHours: number;
  title: string;
  slug: string;
}

const FIX_META: Partial<Record<string, FixMeta>> = {
  LCP_IMAGE_PRELOAD: {
    savingsUsd: 7777,
    effortHours: 4,
    title: 'Preload hero image',
    slug: 'lcp-preload',
  },
  SCRIPT_DEFER: {
    savingsUsd: 1245,
    effortHours: 2,
    title: 'Defer non-critical JavaScript',
    slug: 'script-defer',
  },
  SECURITY_HEADERS: {
    savingsUsd: 1891,
    effortHours: 3,
    title: 'Add security headers',
    slug: 'security-headers',
  },
  SERVERLESS_WARMER: {
    savingsUsd: 1,
    effortHours: 1,
    title: 'Provision Lambda warmers',
    slug: 'serverless-warmer',
  },
  WEBHOOK_DEDUPE: {
    savingsUsd: 1,
    effortHours: 1,
    title: 'Deduplicate webhook deliveries',
    slug: 'webhook-dedupe',
  },
  DB_N1_BATCH: {
    savingsUsd: 0,
    effortHours: 2,
    title: 'Batch database queries',
    slug: 'db-n1-batch',
  },
};

function kebabCase(id: string): string {
  return id.toLowerCase().replace(/_+/g, '-');
}

export function deriveBranchName(patches: GeneratedPatch[]): string {
  const ids = [...new Set(patches.map((patch) => patch.fixId))];
  if (ids.length === 1) {
    const slug = FIX_META[ids[0]]?.slug ?? kebabCase(ids[0]);
    return `opspilot/fix-${slug}`;
  }
  return 'opspilot/remediation-batch-1';
}

export interface RemediationPROptions {
  dryRun?: boolean;
  fetchFn?: typeof fetch;
}

export async function createRemediationPR(
  patches: GeneratedPatch[],
  config: PRConfig,
  options?: RemediationPROptions,
): Promise<PRResult> {
  const client = new GitHubClient({
    token: config.token,
    dryRun: options?.dryRun === true,
    fetchFn: options?.fetchFn,
  });
  const owner = config.owner;
  const repo = config.repo;
  const baseBranch = config.baseBranch ?? 'main';
  const branchName = deriveBranchName(patches);
  const refName = `refs/heads/${branchName}`;

  const baseSha = await client.getRef(owner, repo, baseBranch);

  try {
    await client.createRef(owner, repo, refName, baseSha);
  } catch (error) {
    if (!/already exists|422/.test(String(error))) throw error;
    await client.updateRef(owner, repo, refName, baseSha);
  }

  const changed = patches.filter(
    (patch) => patch.patchedContent !== patch.originalContent,
  );
  if (changed.length === 0) {
    throw new Error('No changed files to commit');
  }

  const items: TreeItem[] = changed.map((patch) => ({
    path: patch.targetPath,
    mode: '100644',
    type: 'blob',
    content: patch.patchedContent,
  }));
  const treeSha = await client.createTree(owner, repo, baseSha, items);

  const commitSha = await client.createCommit(
    owner,
    repo,
    `fix(remediation): apply ${branchName} changes`,
    treeSha,
    [baseSha],
  );

  await client.updateRef(owner, repo, refName, commitSha);

  const title = `fix: apply ${branchName} remediation`;
  const body = buildPrBody(changed, branchName);
  const pr = await client.createPullRequest(owner, repo, {
    title,
    head: branchName,
    base: baseBranch,
    body,
  });

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    branchName,
    status: options?.dryRun === true ? 'dry-run' : 'created',
  };
}

function buildPrBody(patches: GeneratedPatch[], branchName: string): string {
  const totalSavings = patches.reduce(
    (sum, patch) => sum + (FIX_META[patch.fixId]?.savingsUsd ?? 0),
    0,
  );
  const totalEffort = patches.reduce(
    (sum, patch) => sum + (FIX_META[patch.fixId]?.effortHours ?? 0),
    0,
  );

  const files = patches
    .map((patch) => {
      const meta = FIX_META[patch.fixId];
      return `- \`${patch.targetPath}\` — ${meta?.title ?? patch.fixId}`;
    })
    .join('\n');

  const diffs = patches
    .filter((patch) => patch.unifiedDiff.length > 0)
    .map(
      (patch) =>
        `<details>\n<summary>${patch.targetPath}</summary>\n\n\`\`\`diff\n${patch.unifiedDiff}\n\`\`\`\n\n</details>`,
    )
    .join('\n');

  return [
    '## 🤖 OpsPilot Remediation Bot',
    '',
    `Automated remediation on branch \`${branchName}\`.`,
    '',
    `- **Estimated savings:** $${totalSavings.toLocaleString('en-US')}/mo`,
    `- **Estimated effort:** ${totalEffort} hour(s)`,
    '',
    '### Files changed',
    '',
    files,
    '',
    '### Diffs',
    '',
    diffs,
    '',
  ].join('\n');
}