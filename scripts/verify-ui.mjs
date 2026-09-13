import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = Number(process.env.VERIFY_PORT ?? 8897);
const BASE = `http://127.0.0.1:${PORT}`;
const SCAN_TARGET = 'https://www.demoblaze.com/';

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

const tsxCli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const devServer = spawn(process.execPath, [tsxCli, join(ROOT, 'scripts', 'dev-server.ts')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
devServer.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
devServer.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

async function main() {
  let browser = null;
  try {
    await waitReady(BASE, 20000);

    const methodRes = await fetch(`${BASE}/api/scan`, { method: 'GET' });
    check('API rejects GET /api/scan with 405', methodRes.status === 405, `status=${methodRes.status}`);

    const badBody = await fetch(`${BASE}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not a url!' }),
    });
    check('API rejects invalid URL with 400', badBody.status === 400, `status=${badBody.status}`);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
    check('UI page loads', (await page.title()).includes('OpsPilot'), `title=${await page.title()}`);
    check('URL form renders', (await page.getByTestId('url-input').count()) === 1);

    await page.getByTestId('url-input').fill(SCAN_TARGET);
    await page.getByTestId('run-audit').click();

    const banner = page.getByTestId('loss-banner-result');
    await banner.waitFor({ timeout: 60000 });
    check('Loss banner renders after live scan', await banner.isVisible());

    const lossBefore = (await page.getByTestId('loss-amount').textContent()) ?? '';
    check(
      'Loss amount is a dollar figure',
      /^\$[\d,]+$/.test(lossBefore.trim()),
      `amount=${lossBefore.trim()}`,
    );

    const cards = ['metric-performance', 'metric-bloat', 'metric-security'];
    for (const card of cards) {
      check(`${card} rendered`, (await page.getByTestId(card).count()) === 1);
    }

    const modal = page.getByTestId('lead-modal');
    await modal.waitFor({ timeout: 10000 });
    check('Lead capture modal appears after report', await modal.isVisible());

    const email = 'verify.lead+test@example.com';
    await page.getByTestId('lead-email').fill(email);
    await page.getByTestId('lead-submit').click();
    await page.getByTestId('lead-success').waitFor({ timeout: 10000 });
    check('Lead submission acknowledged in UI', true);

    const trafficSlider = page.getByTestId('traffic-slider');
    await trafficSlider.evaluate((el, value) => {
      const input = el;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 100000);
    await page.waitForTimeout(250);
    const lossAfter = (await page.getByTestId('loss-amount').textContent()) ?? '';
    check(
      'Loss re-computes in real time when baseline changes',
      lossAfter !== lossBefore && lossAfter !== '',
      `before=${lossBefore.trim()} after=${lossAfter.trim()}`,
    );

    const leadsFile = join(ROOT, 'data', 'leads.jsonl');
    let leadsContent = '';
    try {
      leadsContent = readFileSync(leadsFile, 'utf8');
    } catch {
      /* missing */
    }
    check('Lead persisted to data/leads.jsonl', leadsContent.includes(email.toLowerCase()));

    check('No uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser?.close();
    devServer.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

main()
  .catch((err) => {
    console.error('VERIFY FAILED:', err?.message ?? err);
    console.error(serverOutput);
    failed += 1;
  })
  .finally(() => {
    process.exitCode = failed > 0 ? 1 : 0;
    process.exit();
  });