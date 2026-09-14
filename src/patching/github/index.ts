export { GitHubClient } from './client';
export type { GitHubClientOptions } from './client';
export { createRemediationPR, deriveBranchName } from './automator';
export type { RemediationPROptions } from './automator';
export type {
  PRConfig,
  CreatePRPayload,
  PRResult,
  PRStatus,
  TreeItem,
  GitRefResponse,
  CommitResponse,
  TreeResponse,
  PullRequestResponse,
} from './types';