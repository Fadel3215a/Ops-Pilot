import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditSnapshot } from './types';

export const DEFAULT_HISTORY_PATH = path.join(
  process.cwd(),
  'data',
  'watchdog-history.json',
);

export const HISTORY_LIMIT = 100;

export async function loadHistory(
  filePath: string = DEFAULT_HISTORY_PATH,
): Promise<AuditSnapshot[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAuditSnapshot);
  } catch {
    return [];
  }
}

export async function saveSnapshot(
  snapshot: AuditSnapshot,
  filePath: string = DEFAULT_HISTORY_PATH,
): Promise<AuditSnapshot[]> {
  const current = await loadHistory(filePath);
  const next = [...current, snapshot].slice(-HISTORY_LIMIT);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function clearHistory(
  filePath: string = DEFAULT_HISTORY_PATH,
): Promise<void> {
  await rm(filePath, { force: true });
}

function isAuditSnapshot(value: unknown): value is AuditSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.timestamp === 'string' &&
    typeof record.targetUrl === 'string' &&
    typeof record.frontendLossUsd === 'number' &&
    typeof record.backendWasteUsd === 'number' &&
    typeof record.combinedLossUsd === 'number' &&
    (typeof record.topFixId === 'string' || record.topFixId === null) &&
    typeof record.performanceScore === 'number'
  );
}