export interface PRConfig {
  owner: string;
  repo: string;
  token: string;
  baseBranch?: string;
}

export interface CreatePRPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface TreeItem {
  path: string;
  mode: string;
  type: string;
  content: string;
}

export type PRStatus = 'created' | 'dry-run';

export interface PRResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
  status: PRStatus;
}

export interface GitRefResponse {
  ref: string;
  object: { sha: string };
}

export interface CommitResponse {
  sha: string;
}

export interface TreeResponse {
  sha: string;
}

export interface PullRequestResponse {
  number: number;
  html_url: string;
}