import { runDaemonFromCli, syntheticScanResult } from '../../watchdog';
import type { CliCommandArgs, CliDeps } from '../args';

export async function watchCommand(
  args: CliCommandArgs,
  deps: CliDeps = {},
): Promise<number> {
  if (!args.url) {
    console.error('opspilot watch: missing --url/--target');
    return 1;
  }

  const tokens = [`--target=${args.url}`, `--interval=${args.intervalMinutes}`];
  if (args.webhookUrl) tokens.push(`--webhook=${args.webhookUrl}`);
  if (args.once) tokens.push('--once');

  const code = await runDaemonFromCli(tokens, {
    scan: deps.scan ?? (args.dryRun ? syntheticScanResult : undefined),
    fetchFn: deps.fetchFn,
    historyPath: deps.historyPath,
  });
  return code === 0 ? 1 : 0;
}