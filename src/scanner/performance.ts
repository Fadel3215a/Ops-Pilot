import type { Page } from 'playwright';

export const PERFORMANCE_OBSERVER_INIT_SCRIPT = `
window.__opsPilotLongTasks = [];
window.__opsPilotLcp = 0;
try {
  new PerformanceObserver(function (list) {
    var entries = list.getEntries();
    for (var i = 0; i < entries.length; i += 1) {
      window.__opsPilotLongTasks.push(entries[i].duration);
    }
  }).observe({ entryTypes: ['longtask'] });
} catch (err) {}
try {
  new PerformanceObserver(function (list) {
    var entries = list.getEntries();
    if (entries.length > 0) {
      window.__opsPilotLcp = entries[entries.length - 1].startTime;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (err) {}
`;

interface RichWindow extends Window {
  __opsPilotLongTasks?: number[];
  __opsPilotLcp?: number;
}

export async function readPerfTiming(page: Page): Promise<{ ttfb: number; domContentLoaded: number }> {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      ttfb: navigation?.responseStart ?? 0,
      domContentLoaded: navigation?.domContentLoadedEventStart ?? 0,
    };
  });
}

export async function readLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as RichWindow;
    return Array.isArray(w.__opsPilotLongTasks) ? w.__opsPilotLongTasks : [];
  });
}

export async function readLcp(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as RichWindow;
    return typeof w.__opsPilotLcp === 'number' ? w.__opsPilotLcp : 0;
  });
}

export async function waitForLcp(page: Page, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lcp = await readLcp(page);
    if (lcp > 0) return lcp;
    await page.waitForTimeout(200);
  }
  return readLcp(page);
}

export function computeBlockingTime(durations: number[], thresholdMs = 50): number {
  return durations.reduce((total, duration) => total + Math.max(duration - thresholdMs, 0), 0);
}