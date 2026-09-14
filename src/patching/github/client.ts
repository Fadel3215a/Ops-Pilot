import type {
  CommitResponse,
  CreatePRPayload,
  GitRefResponse,
  PullRequestResponse,
  TreeItem,
  TreeResponse,
} from './types';

export interface GitHubClientOptions {
  token: string;
  dryRun?: boolean;
  fetchFn?: typeof fetch;
}

const API_ROOT = 'https://api.github.com';
const DEFAULT_ACCEPT = 'application/vnd.github+json';

function normalizeBranch(branch: string): string {
  return branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch;
}

export class GitHubClient {
  readonly dryRun: boolean;

  private readonly token: string;

  private readonly fetchFn: typeof fetch;

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.dryRun = options.dryRun === true;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getRef(owner: string, repo: string, branch: string): Promise<string> {
    if (this.dryRun) return 'dryrun-base-sha';
    const path = `/repos/${owner}/${repo}/git/ref/heads/${normalizeBranch(branch)}`;
    const response = await this.request<GitRefResponse>('GET', path);
    return response.object.sha;
  }

  async createRef(
    owner: string,
    repo: string,
    refName: string,
    sha: string,
  ): Promise<GitRefResponse> {
    if (this.dryRun) return { ref: refName, object: { sha } };
    const path = `/repos/${owner}/${repo}/git/refs`;
    return this.request<GitRefResponse>('POST', path, { ref: refName, sha });
  }

  async createTree(
    owner: string,
    repo: string,
    baseTree: string,
    items: TreeItem[],
  ): Promise<string> {
    if (this.dryRun) return `dryrun-tree-${items.length}`;
    const path = `/repos/${owner}/${repo}/git/trees`;
    const response = await this.request<TreeResponse>('POST', path, {
      base_tree: baseTree,
      tree: items,
    });
    return response.sha;
  }

  async createCommit(
    owner: string,
    repo: string,
    message: string,
    tree: string,
    parents: string[],
  ): Promise<string> {
    if (this.dryRun) return 'dryrun-commit-sha';
    const path = `/repos/${owner}/${repo}/git/commits`;
    const response = await this.request<CommitResponse>('POST', path, {
      message,
      tree,
      parents,
    });
    return response.sha;
  }

  async updateRef(
    owner: string,
    repo: string,
    refName: string,
    sha: string,
  ): Promise<GitRefResponse> {
    if (this.dryRun) return { ref: refName, object: { sha } };
    const path = `/repos/${owner}/${repo}/git/refs/${refName}`;
    return this.request<GitRefResponse>('PATCH', path, { sha, force: true });
  }

  async createPullRequest(
    owner: string,
    repo: string,
    payload: CreatePRPayload,
  ): Promise<PullRequestResponse> {
    if (this.dryRun) {
      return { number: 303, html_url: `https://github.com/${owner}/${repo}/pull/303` };
    }
    const path = `/repos/${owner}/${repo}/pulls`;
    return this.request<PullRequestResponse>('POST', path, payload);
  }

  private async request<T>(method: string, path: string, body?: object): Promise<T> {
    const headers: Record<string, string> = {
      Accept: DEFAULT_ACCEPT,
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchFn(`${API_ROOT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `GitHub API ${method} ${path} failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }
}