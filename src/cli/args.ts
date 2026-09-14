import type { ScanResult } from '../scanner/types';

export type CliCommand = 'audit' | 'patch' | 'watch' | 'version' | 'help';

export interface CliCommandArgs {
  command: CliCommand;
  url?: string;
  intervalMinutes: number;
  webhookUrl?: string;
  once: boolean;
  dryRun: boolean;
  repo?: string;
  logsPath?: string;
}

export interface CliDeps {
  scan?: (url: string) => Promise<ScanResult> | ScanResult;
  fetchFn?: typeof fetch;
  historyPath?: string;
  token?: string;
}

export const VERSION = '1.0.0';

export const USAGE = [
  'Usage: opspilot <command> [options]',
  '',
  'Commands:',
  '  audit     Run an on-demand audit (scanner + loss engine + log parser)',
  '  patch     Generate AST remediation patches and optionally open a GitHub PR',
  '  watch     Poll audits on a schedule and dispatch alerts',
  '',
  'Options:',
  '  --url=<url>          Target storefront URL (alias: --target)',
  '  --target=<url>       Alias for --url',
  '  --interval=<mins>    Watch interval in minutes (default: 15)',
  '  --webhook=<url>      Alert webhook URL',
  '  --once               Run a single audit then exit',
  '  --dry-run            Simulate without side effects',
  '  --repo=<owner/name>  Open a GitHub PR for the patch (requires GITHUB_TOKEN)',
  '  --logs=<file.json>   RawLogItem[] JSON file for the log parser',
  '  --help               Show this help',
  '  --version            Print the version',
  '',
].join('\n');

const SUBCOMMANDS: readonly CliCommand[] = ['audit', 'patch', 'watch'];

function setTarget(current: string | undefined, value: string): string {
  if (value.trim().length === 0) throw new Error('Target URL must not be empty');
  if (current !== undefined && current !== value) {
    throw new Error('Provide either --url or --target, not both');
  }
  return value;
}

function parseInterval(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --interval: ${raw}`);
  }
  return value;
}

function parseRepo(raw: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    throw new Error(`Invalid --repo: ${raw} (expected owner/name)`);
  }
  return raw;
}

export function parseCliArgs(argv: readonly string[]): CliCommandArgs {
  const args: CliCommandArgs = {
    command: 'help',
    url: undefined,
    intervalMinutes: 15,
    webhookUrl: undefined,
    once: false,
    dryRun: false,
    repo: undefined,
    logsPath: undefined,
  };

  for (const token of argv) {
    if (token === '--help') {
      args.command = 'help';
    } else if (token === '--version') {
      args.command = 'version';
    } else if (token === '--once') {
      args.once = true;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token.startsWith('--url=')) {
      args.url = setTarget(args.url, token.slice('--url='.length));
    } else if (token.startsWith('--target=')) {
      args.url = setTarget(args.url, token.slice('--target='.length));
    } else if (token.startsWith('--interval=')) {
      args.intervalMinutes = parseInterval(token.slice('--interval='.length));
    } else if (token.startsWith('--webhook=')) {
      const value = token.slice('--webhook='.length);
      if (value.trim().length === 0) throw new Error('Webhook URL must not be empty');
      args.webhookUrl = value;
    } else if (token.startsWith('--repo=')) {
      args.repo = parseRepo(token.slice('--repo='.length));
    } else if (token.startsWith('--logs=')) {
      const value = token.slice('--logs='.length);
      if (value.trim().length === 0) throw new Error('Log file path must not be empty');
      args.logsPath = value;
    } else if (token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`);
    } else if ((SUBCOMMANDS as readonly string[]).includes(token)) {
      args.command = token as CliCommand;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.command === 'audit' || args.command === 'patch' || args.command === 'watch') {
    if (!args.url) {
      throw new Error(`Missing required --url/--target for ${args.command}`);
    }
  }

  return args;
}