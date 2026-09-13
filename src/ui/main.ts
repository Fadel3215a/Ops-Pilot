import { calculateLoss } from '../engine';
import type { LossAnalysis, StoreBaseline } from '../engine/types';
import type { ScanResult } from '../scanner/types';
import { AuditForm } from './components/AuditForm';
import { LossBanner } from './components/LossBanner';
import { MetricBreakdown } from './components/MetricBreakdown';
import { LeadCaptureModal } from './components/LeadCaptureModal';

interface ApiScanResponse {
  ok: boolean;
  url?: string;
  baseline?: StoreBaseline;
  scan?: ScanResult;
  loss?: LossAnalysis;
  error?: string;
}

interface ApiLeadResponse {
  ok: boolean;
  captured?: boolean;
  error?: string;
}

function required<T extends Element>(query: string): T {
  const el = document.querySelector<T>(query);
  if (el === null) throw new Error(`Missing mount point: ${query}`);
  return el;
}

function main(): void {
  const auditForm = new AuditForm(required('#form-mount'), {
    onScan: (url) => void handleScan(url),
    onBaselineChange: (baseline) => applyBaseline(baseline),
  });
  const lossBanner = new LossBanner(required('#banner-mount'));
  const metrics = new MetricBreakdown(required('#metrics-mount'));
  const modal = new LeadCaptureModal(required('#modal-mount'), async (email, scanUrl) => {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, scanUrl, source: 'instant-audit' }),
    });
    const payload = (await response.json()) as ApiLeadResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? 'Lead capture failed');
    }
  });

  let lastScan: ScanResult | null = null;
  let currentBaseline: StoreBaseline = auditForm.getBaseline();

  function applyBaseline(baseline: StoreBaseline): void {
    currentBaseline = { ...baseline };
    if (lastScan !== null) {
      const recomputed = calculateLoss(lastScan, currentBaseline);
      lossBanner.setResult(recomputed);
    }
  }

  async function handleScan(url: string): Promise<void> {
    lossBanner.setLoading();
    auditForm.setLoading(true);
    metrics.clear();
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, baseline: currentBaseline }),
      });
      const payload = (await response.json()) as ApiScanResponse;
      if (!response.ok || payload.scan === undefined || payload.loss === undefined) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      lastScan = payload.scan;
      const loss = payload.loss;
      lossBanner.setResult(loss);
      metrics.render(payload.scan);
      window.setTimeout(() => modal.show(payload.url ?? url), 350);
    } catch (err) {
      lossBanner.setError(err instanceof Error ? err.message : String(err));
    } finally {
      auditForm.setLoading(false);
    }
  }
}

main();