import {
  parseCliArgs,
  USAGE,
  VERSION,
} from './args';
import type { CliCommandArgs, CliDeps } from './args';
import { auditCommand } from './commands/audit';
import { patchCommand } from './commands/patch';
import { watchCommand } from './commands/watch';

export async function main(
  argv: readonly string[],
  deps: CliDeps = {},
): Promise<number> {
  let parsed: CliCommandArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(`opspilot: ${(error as Error).message}`);
    console.error(USAGE);
    return 1;
  }

  switch (parsed.command) {
    case 'version':
      console.log(`opspilot ${VERSION}`);
      return 0;
    case 'help':
      console.log(USAGE);
      return 0;
    case 'audit':
      return auditCommand(parsed, deps);
    case 'patch':
      return patchCommand(parsed, deps);
    case 'watch':
      return watchCommand(parsed, deps);
  }
}