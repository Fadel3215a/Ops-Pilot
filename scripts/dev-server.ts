import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import handleScan from '../api/scan.ts';
import handleLead from '../api/leads.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1';
const DIST_DIR = join(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST') {
      resolve(undefined);
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
    });
    req.on('end', () => {
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
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(DIST_DIR, safePath);
  const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
  try {
    statSync(filePath);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
}

type RouteHandler = (
  req: { method?: string; body?: unknown; on?: (event: string, handler: (...args: unknown[]) => void) => void },
  res: ServerResponse,
) => Promise<void>;

function bridge(handler: RouteHandler, req: IncomingMessage, res: ServerResponse): void {
  void readBody(req)
    .then((body) => {
      const bridgeReq: {
        method?: string;
        body?: unknown;
        on?: (event: string, handler: (...args: unknown[]) => void) => void;
      } = { method: req.method, body };
      if (req.method === 'POST') {
        bridgeReq.on = (event: string, handler): void => {
          req.on(event as 'data' | 'end' | 'error', ((...args: unknown[]) => handler(...args)) as never);
        };
      }
      const cap = setTimeout(() => {
        if (!res.writableEnded) sendJson(res, 504, { ok: false, error: 'Request timed out' });
      }, 40_000);
      void handler(bridgeReq, res).finally(() => clearTimeout(cap));
    })
    .catch((err) => {
      if (!res.writableEnded) sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];

  if (pathname === '/api/scan') {
    bridge(handleScan as unknown as RouteHandler, req, res);
    return;
  }

  if (pathname === '/api/leads') {
    bridge(handleLead as unknown as RouteHandler, req, res);
    return;
  }

  serveStatic(res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`OpsPilot dev server ready at http://${HOST}:${PORT}`);
});