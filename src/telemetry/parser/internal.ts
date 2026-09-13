import type { LogSource } from './types';

export const WASTE_USD_PER_MS: Record<LogSource, number> = {
  aws: 8.5e-9,
  vercel: 4.4e-9,
  shopify: 2.5e-9,
};

export const WASTE_ROUND_DECIMALS = 10;

export function roundWaste(value: number): number {
  const factor = 10 ** WASTE_ROUND_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function toEpochMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : NaN;
}