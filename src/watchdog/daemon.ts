import type { RawLogItem } from '../telemetry/parser/types';
import type { ScanResult } from '../scanner/types';
import { dispatchAlerts, evaluateAlerts } from './alerts';
import type { AlertPayload } from './alerts';
import { runAuditCycle } from './core';
import { DEFAULT_HISTORY_PATH, loadHistory, saveSnapshot } from './history';
import type { AuditSnapshot } from './types';

export type ScanProvider = (url: string) => Promise<ScanResult> | ScanResult;

export interface WatchdogDaemonOptions {
  targetUrl: string;
  intervalMs: number;
  webhookUrl?: string;
  logItems?: RawLogItem[];
  historyPath?: string;
  scan?: ScanProvider;
  fetchFn?: typeof fetch;
}

export class WatchdogDaemon {
  readonly targetUrl: string;

  lastTickAlerts: AlertPayload[] = [];
  lastDispatched = 0;
  tickCount = 0;
  lastError: unknown = null;

  private readonly intervalMs: number;
  private readonly webhookUrl?: string;
  private readonly logItems: RawLogItem[];
  private readonly historyPath: string;
  private readonly scan?: ScanProvider;
  private readonly fetchFn?: typeof fetch;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WatchdogDaemonOptions) {
    if (options.intervalMs <= 0) {
      throw new Error('intervalMs must be a positive number');
    }
    this.targetUrl = options.targetUrl;
    this.intervalMs = options.intervalMs;
    this.webhookUrl = options.webhookUrl;
    this.logItems = options.logItems ?? [];
    this.historyPath = options.historyPath ?? DEFAULT_HISTORY_PATH;
    this.scan = options.scan;
    this.fetchFn = options.fetchFn;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.lastError = error;
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async tick(): Promise<AuditSnapshot> {
    const snapshot = await runAuditCycle(this.targetUrl, this.logItems, {
      scan: this.scan,
    });

    const history = await loadHistory(this.historyPath);
    const previous = history.length > 0 ? history[history.length - 1] : undefined;

    const alerts = evaluateAlerts(snapshot, previous);
    this.lastTickAlerts = alerts;
    this.lastDispatched = await dispatchAlerts(
      alerts,
      this.webhookUrl,
      this.fetchFn,
    );

    await saveSnapshot(snapshot, this.historyPath);
    this.tickCount += 1;
    return snapshot;
  }
}

export interface DaemonCliArgs {
  targetUrl: string;
  intervalMinutes: number;
  webhookUrl?: string;
  once: boolean;
}

export function parseDaemonArgs(args: string[]): DaemonCliArgs {
  const parsed: DaemonCliArgs = {
    targetUrl: '',
    intervalMinutes: 15,
    webhookUrl: undefined,
    once: false,
  };

  for (const arg of args) {
    if (arg === '--once') {
      parsed.once = true;
    } else if (arg.startsWith('--target=')) {
      parsed.targetUrl = arg.slice('--target='.length);
    } else if (arg.startsWith('--interval=')) {
      const minutes = Number(arg.slice('--interval='.length));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`Invalid --interval value: "${arg}"`);
      }
      parsed.intervalMinutes = minutes;
    } else if (arg.startsWith('--webhook=')) {
      parsed.webhookUrl = arg.slice('--webhook='.length);
    }
  }

  if (parsed.targetUrl === '') {
    throw new Error('Missing required --target=<url>');
  }
  return parsed;
}

export interface DaemonCliOverrides {
  scan?: ScanProvider;
  fetchFn?: typeof fetch;
  historyPath?: string;
}

export async function runDaemonFromCli(
  args: string[],
  overrides: DaemonCliOverrides = {},
): Promise<number> {
  let cli: DaemonCliArgs;
  try {
    cli = parseDaemonArgs(args);
  } catch (error) {
    console.error(`Watchdog: ${String(error)}`);
    return 0;
  }

  const daemon = new WatchdogDaemon({
    targetUrl: cli.targetUrl,
    intervalMs: cli.intervalMinutes * 60_000,
    webhookUrl: cli.webhookUrl,
    scan: overrides.scan,
    fetchFn: overrides.fetchFn,
    historyPath: overrides.historyPath,
  });

  if (cli.once) {
    const snapshot = await daemon.tick();
    console.log(
      `Watchdog audit complete: score=${snapshot.performanceScore}, combinedLossUsd=${snapshot.combinedLossUsd}`,
    );
    return 1;
  }

  daemon.start();
  console.log(
    `Watchdog scheduling audits for ${cli.targetUrl} every ${cli.intervalMinutes}m (webhook: ${cli.webhookUrl !== undefined ? 'enabled' : 'disabled'})`,
  );
  return 1;
}