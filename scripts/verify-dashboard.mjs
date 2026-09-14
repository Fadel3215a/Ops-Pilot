import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = Number(process.env.VERIFY_PORT ?? 8898);
const BASE = `http://127.0.0.1:${PORT}`;
const DASHBOARD_URL = `${BASE}/dashboard/index.html`;

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function waitReady(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Dev server did not become ready');
}

async function main() {
  let browser = null;
  let devServer = null;

  const builder = spawn(process.execPath, [join(ROOT, 'scripts', 'build-dashboard.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const buildOutput = await new Promise((resolve) => {
    let out = '';
    builder.stdout.on('data', (c) => { out += c.toString(); });
    builder.stderr.on('data', (c) => { out += c.toString(); });
    builder.on('exit', (code) => resolve({ code, out }));
  });
  check('dashboard bundle builds via esbuild', (buildOutput.code ?? 1) === 0, `code=${buildOutput.code}`);

  const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  devServer = spawn(process.execPath, [tsxCli, join(ROOT, 'scripts', 'dev-server.ts')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  devServer.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  devServer.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitReady(BASE, 20000);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(DASHBOARD_URL, { waitUntil: 'load', timeout: 30000 });
    check('Dashboard page loads', (await page.title()).includes('OpsPilot'), `title=${await page.title()}`);

    const heroTotal = (await page.getByTestId('combined-loss-total').textContent()) ?? '';
    const frontend = (await page.getByTestId('frontend-loss').textContent()) ?? '';
    const backend = (await page.getByTestId('backend-loss').textContent()) ?? '';
    check('Hero total renders as dollar figure', /^\$?[\d,]+$/.test(heroTotal.trim()), `total=${heroTotal.trim()}`);
    check('Front-end chip renders as integer dollars', /^\s*\$[\d,]+(?:\s|$)/m.test(frontend), `front=${frontend.trim()}`);
    check('Back-end chip renders as decimal dollars', /^\s*\$\d+(\.\d{2})?(?:\s|$)/m.test(backend), `back=${backend.trim()}`);

    const parseDollars = (text) => {
      const match = text.match(/(?:\$)?([\d,]+(?:\.\d{2})?)/);
      return match ? Number(match[1].replace(/,/g, '')) : NaN;
    };
    const totalN = parseDollars(heroTotal);
    const frontN = parseDollars(frontend);
    const backN = parseDollars(backend);
    check('Hero combines front-end + back-end', totalN === Math.round(frontN + backN), `total=${totalN} expected=${Math.round(frontN + backN)}`);
    check('Back-end waste contributes non-zero monthly value', backN > 0, `back=${backN}`);
    check('Front-end leak dwarfs back-end waste in estimate', frontN > backN, `front=${frontN} back=${backN}`);

    const providers = ['shopify', 'vercel', 'aws', 'hubspot'];
    for (const provider of providers) {
      const badge = page.getByTestId(`session-card-${provider}`);
      check(`Session badge renders for ${provider}`, (await badge.count()) === 1);
      check(`Session badge is READ-ONLY for ${provider}`, ((await badge.textContent()) ?? '').includes('READ-ONLY'));
    }
    check('Session status line reports healthy sessions', ((await page.getByTestId('session-status-line').textContent()) ?? '').includes('4/4'), await page.getByTestId('session-status-line').textContent());

    const mockPills = await page.getByTestId('auth-mode-label').count();
    check('Auth toggle label initializes to MOCK', mockPills === 1 && ((await page.getByTestId('auth-mode-label').textContent()) ?? '') === 'MOCK', await page.getByTestId('auth-mode-label').textContent());

    await page.getByTestId('auth-toggle').click();
    await page.waitForTimeout(250);
    for (const provider of providers) {
      check(`Session badge survives live/mock toggle for ${provider}`, (await page.getByTestId(`session-card-${provider}`).count()) === 1);
    }

    check('Cold start card renders count/latency/waste', ((await page.getByTestId('cold-start-card').count()) === 1));
    check('Cold count matches fixture (4 cold executions)', ((await page.getByTestId('cold-count').textContent()) ?? '').trim() === '4', await page.getByTestId('cold-count').textContent());
    check('Sync redundant calls match combined fixture (6 duplicates)', ((await page.getByTestId('sync-redundant').textContent()) ?? '').trim() === '6', await page.getByTestId('sync-redundant').textContent());
    check('Sync loops detected across combined fixture (3 groups)', ((await page.getByTestId('sync-loops').textContent()) ?? '').trim() === '3', await page.getByTestId('sync-loops').textContent());
    check('DB bottlenecks match fixture (15 slow/N+1)', ((await page.getByTestId('db-slow').textContent()) ?? '').trim() === '15', await page.getByTestId('db-slow').textContent());
    check('DB average duration renders', ((await page.getByTestId('db-avg').textContent()) ?? '') !== '', await page.getByTestId('db-avg').textContent());

    const streamCount = (await page.getByTestId('telemetry-count').textContent()) ?? '';
    check('Telemetry summary shows parsed log count (30)', /^\s*30 LOGS/.test(streamCount), streamCount.trim());
    const entryCount = await page.getByTestId('telemetry-entry').count();
    check('Telemetry stream renders raw log entries (>= 30)', entryCount >= 30, `entries=${entryCount}`);
    check('Cold-start row is flagged in stream', (await page.locator('.cold-mark').count()) >= 1);

    check('No uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser?.close();
    if (devServer) {
      devServer.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

main()
  .catch((err) => {
    console.error('VERIFY DASHBOARD FAILED:', err?.message ?? err);
    console.error(serverOutput);
    failed += 1;
  })
  .finally(() => {
    process.exitCode = failed > 0 ? 1 : 0;
    process.exit();
  });