import { scanUrl } from './index';

const DEFAULT_TARGET = 'https://www.demoblaze.com/';
const target = typeof process.env.SCAN_URL === 'string' && process.env.SCAN_URL.trim() !== ''
  ? process.env.SCAN_URL.trim()
  : DEFAULT_TARGET;

async function main(): Promise<void> {
  console.log(`Target: ${target}`);
  const startedAt = Date.now();
  const result = await scanUrl(target);
  console.log(`Duration: ${Date.now() - startedAt}ms`);
  console.log(JSON.stringify(result, null, 2));
  if (result.error) {
    console.error(`Scan error: ${result.error}`);
  }
}

main().catch((err: unknown) => {
  console.error('Unexpected scanner failure:', err);
  process.exitCode = 1;
});