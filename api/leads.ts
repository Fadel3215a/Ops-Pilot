import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const LEADS_DIR = join(process.cwd(), 'data');
const LEADS_FILE = join(LEADS_DIR, 'leads.jsonl');

interface LeadRequest {
  method?: string;
  body?: unknown;
  on?: (event: 'data' | 'end' | 'error', handler: (...args: never[]) => void) => void;
}

interface LeadResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface Lead {
  email: string;
  source: string;
  intent: string;
  scanUrl: string | null;
  capturedAt: string;
}

function sendJson(res: LeadResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: LeadRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on?.('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on?.('end', () => {
      if (raw.trim() === '') {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on?.('error', reject);
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handleLead(req: LeadRequest, res: LeadResponse): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const data = (body ?? {}) as { email?: unknown; source?: unknown; scanUrl?: unknown };
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    sendJson(res, 400, { ok: false, error: 'A valid email address is required' });
    return;
  }

  const lead: Lead = {
    email,
    source: typeof data.source === 'string' ? data.source : 'instant-audit',
    intent: 'remediation-pdf',
    scanUrl: typeof data.scanUrl === 'string' ? data.scanUrl : null,
    capturedAt: new Date().toISOString(),
  };

  try {
    await mkdir(LEADS_DIR, { recursive: true });
    await appendFile(LEADS_FILE, `${JSON.stringify(lead)}\n`, 'utf8');
  } catch (err) {
    console.error('Lead persistence error:', err);
  }

  if (process.env.LEAD_WEBHOOK_URL) {
    void fetch(process.env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    }).catch((err) => console.error('Lead webhook error:', err));
  }

  sendJson(res, 200, {
    ok: true,
    captured: true,
    message: 'Lead captured. Onboarding will reach out to you.',
  });
}

export { handleLead as handler };