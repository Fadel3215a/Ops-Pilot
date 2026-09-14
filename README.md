# OpsPilot AI

**E-Commerce Loss Scanner, AST Auto-Patcher & Watchdog Daemon.**

OpsPilot continuously quantifies storefront performance and backend efficiency
loss for e-commerce operations, then acts on it: it scans a live storefront,
combines the results with parsed telemetry logs, proposes ranked remediation
fixes, generates AST-verified patch files, opens GitHub Pull Requests, and
monitors for regressions over time.

```
Scanner ──> Loss Engine ──> Telemetry Parser ──> Edge UI/Dashboard (Static)
   │             │                  │
   │             └──────┬───────────┘
   │                    ▼
   │           Remediation Engine (ranked fixes)
   │                    │
   │                    ▼
   │           AST Patch Generator ──> GitHub PR Automator
   │                    │
   │                    ▼
   │           Watchdog Daemon (scheduled audits + alert webhooks)
   │                    │
   │                    ▼
   │           Unified CLI (audit / patch / watch) ──> dist/opspilot.cjs
   └───────────────────────────────────────────────────────────────┘
```

## Architecture Overview

| Stage | Module | Responsibility | Location |
| --- | --- | --- | --- |
| **1** | Scans & Loss Engine | Crawls a storefront with a headless browser (scanner) and converts the results into monthly revenue-loss estimates + security-tax-aware score | `src/scanner`, `src/engine` |
| **2** | Telemetry + Edge UI | Read-only OAuth scopes per provider, backend log parsing (cold starts, sync loops, DB bottlenecks), and lightweight static dashboards | `src/telemetry`, `src/ui` |
| **3** | Remediation & Patching | Ranks actionable fixes by ROI, generates AST-transform patches with unified diffs, and opens GitHub PRs | `src/remediation`, `src/patching` |
| **4** | Watchdog Daemon | Scheduled audits, rolling snapshot history, threshold & regression alert rules, and Slack/Discord-style webhook dispatch | `src/watchdog` |
| **5** | CLI & Release | Unified subcommand router, esbuild production bundle, and end-to-end integration verification | `src/cli`, `scripts`, `tests/e2e` |

## Installation & Build

Requires **Node.js 18+**.

```bash
npm install
npm run build        # bundles UI, dashboard, and the CLI into dist/
npm link             # exposes the `opspilot` command globally (uses dist/opspilot.cjs)
```

`npm run build` invokes `scripts/build-ui.mjs`, `scripts/build-dashboard.mjs`,
and `scripts/build-cli.mjs`. The CLI bundle is emitted to `dist/opspilot.cjs`
(a single CommonJS executable with a `#!/usr/bin/env node` shebang).
`playwright` and `typescript5` are runtime externals resolved from
`node_modules`; everything else is inlined.

## CLI Reference

The CLI also runs without installation:

```bash
node dist/opspilot.cjs <command> [options]
```

### `opspilot audit --url=<url> [--logs=<path>] [--dry-run]`

Runs scan + loss engine + log parser and prints a formatted terminal summary
(frontend / backend / combined loss, performance score, top fix).

| Option | Description |
| --- | --- |
| `--url=<url>` / `--target=<url>` | Storefront URL to audit (**required**) |
| `--logs=<path>` | JSON file containing a `RawLogItem[]` array for backend waste analysis |
| `--dry-run` | Use the offline synthetic scan (no headless browser) |

### `opspilot patch --url=<url> [--repo=<owner/name>] [--dry-run]`

Runs the audit, generates AST patches per ranked fix, prints the plan, and —
when `--repo` is supplied — opens a GitHub Pull Request. Real PRs require
`GITHUB_TOKEN`; without a token, use `--dry-run` to preview the PR.

| Option | Description |
| --- | --- |
| `--url=<url>` / `--target=<url>` | Storefront URL (**required**) |
| `--repo=<owner/name>` | Open a PR against that repository (branch `opspilot/fix-<slug>`) |
| `--logs=<path>` | Backend log file to include in the plan |
| `--dry-run` | Synthetic scan + dry-run PR (no network, no token needed) |

### `opspilot watch --target=<url> [--interval=<mins>] [--webhook=<url>] [--once]`

Runs scheduled audits on an interval and dispatches alerts to a webhook when a
snapshot exceeds $10,000/mo combined loss, backend waste exceeds $50/mo, or
the performance score drops by 15+ points vs the previous snapshot.
Snapshots persist to `data/watchdog-history.json` (rolling window of 100).

| Option | Description |
| --- | --- |
| `--target=<url>` / `--url=<url>` | Storefront URL (**required**) |
| `--interval=<mins>` | Audit interval in minutes (default `15`) |
| `--webhook=<url>` | Alert webhook URL (Slack/Discord-compatible JSON) |
| `--once` | Run a single audit cycle, dispatch any alerts, then exit |
| `--dry-run` | Synthetic scans (offline) |

### Global flags

| Flag | Description |
| --- | --- |
| `--help` | Print usage |
| `--version` | Print version |

## Environment Variables

| Variable | Used By | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | `opspilot patch` | Access token for opening real PRs when `--repo` is set |
| `USE_MOCK_AUTH` | Telemetry auth | `true` forces mock (read-only) provider sessions |
| `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_SCOPES` | Telemetry auth | Shopify read-only OAuth session credentials |
| `VERCEL_TOKEN`, `VERCEL_SCOPES`, `VERCEL_TEAM_ID` | Telemetry auth | Vercel read-only session credentials |
| `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `AWS_POLICY`, `AWS_ROLE_SESSION_NAME` | Telemetry auth | AWS read-only session credentials |
| `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_SCOPES`, `HUBSPOT_PORTAL_ID` | Telemetry auth | HubSpot read-only session credentials |
| `PORT` | Dev server | Local dashboard server port (default in `scripts/dev-server.ts`) |
| `SCAN_URL` | Interactive scanner tests | Real (non-synthetic) scan target for test runs |

> **Security:** session credential scopes are enforced read-only for every
> provider; credentials are never written to `dist/`, `data/`, or committed.
> `data/` and `dist/` are gitignored.

## Verification & Test Suite

### Requirements

```bash
npm run typecheck   # strict tsc across 13 TypeScript projects
npm run test:e2e    # System E2E: full pipeline incl. compiled dist/opspilot.cjs
npm run verify:cli  # rebuilds dist/opspilot.cjs and exercises it via node
```

### Full suite

| Script | Scope | Runner |
| --- | --- | --- |
| `test:auth` | Provider scope validation & OAuth session construction | `src/telemetry/auth/test.ts` |
| `test:parser` | Backend log parsing (cold starts, sync loops, DB bottlenecks) | `src/telemetry/parser/test.ts` |
| `test:remediation` | Fix ranking & savings quantification | `src/remediation/test.ts` |
| `test:patching` | AST transformers & unified diff generation | `src/patching/ast/test.ts` |
| `test:github` | Branch derivation & PR pipeline (dry-run) | `src/patching/github/test.ts` |
| `test:watchdog` | Audit cycle scoring & history persistence | `src/watchdog/test.ts` |
| `test:alerts` | Default rules & webhook payload dispatch | `src/watchdog/test-alerts.ts` |
| `test:daemon` | Scheduler lifecycle & CLI `--once` flow | `src/watchdog/test-daemon.ts` |
| `test:cli` | Subcommand parsing & router routing | `src/cli/test.ts` |
| `test:e2e` | Whole-system integration vs the built binary | `tests/e2e/integration.test.ts` |
| `verify:cli` | Rebuild + binary smoke test (`--version`, `--help`, audit) | `scripts/verify-cli.mjs` |
| `verify:dashboard` | Loads the dashboard in headless Chromium | `scripts/verify-dashboard.mjs` |

## Development

```bash
npm run dev               # build UI/dashboard + run the dev server
npm run start             # run the dev server
npm run build:cli         # bundle only dist/opspilot.cjs
npm run test:cli          # CLI parser + routing tests
```

## Repository Layout

```
src/
  scanner/       headless storefront scan (URL, performance, headers)
  engine/        monthly loss analysis, conversion impact, security tax
  telemetry/     provider OAuth (read-only) + backend log parser
  ui/            static UI + dashboard
  remediation/   ranked actionable fixes
  patching/      AST patch transformers + GitHub PR automator
  watchdog/      audit cycle, history, alert rules, daemon scheduler
  cli/           subcommand router (audit / patch / watch)
scripts/         build & verify pipelines
tests/e2e/       system integration verification
dist/            build output (gitignored)
data/            runtime watchdog history (gitignored)
```