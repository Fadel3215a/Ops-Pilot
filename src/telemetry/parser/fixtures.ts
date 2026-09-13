import type { RawLogItem } from './types';

const BASE_MS = Date.parse('2026-09-14T10:00:00.000Z');
const at = (offsetMs: number): string =>
  new Date(BASE_MS + offsetMs).toISOString();

export const COLD_START_LOGS: RawLogItem[] = [
  {
    timestamp: at(0),
    source: 'aws',
    serviceName: 'orders-processor',
    durationMs: 2300,
    isColdStart: true,
    statusCode: 200,
    route: '/orders/process',
  },
  {
    timestamp: at(500),
    source: 'aws',
    serviceName: 'orders-processor',
    durationMs: 4100,
    isColdStart: true,
    statusCode: 200,
    route: '/orders/process',
  },
  {
    timestamp: at(900),
    source: 'aws',
    serviceName: 'orders-processor',
    durationMs: 120,
    isColdStart: false,
    statusCode: 200,
    route: '/orders/process',
  },
  {
    timestamp: at(1000),
    source: 'vercel',
    serviceName: 'storefront-api',
    durationMs: 1500,
    isColdStart: true,
    statusCode: 200,
    route: '/api/storefront',
  },
  {
    timestamp: at(1100),
    source: 'aws',
    serviceName: 'init-bootstrap',
    durationMs: 800,
    statusCode: 200,
    route: '/bootstrap',
  },
];

export const SYNC_LOOP_LOGS: RawLogItem[] = [
  {
    timestamp: at(2000),
    source: 'shopify',
    serviceName: 'webhook-ingest',
    durationMs: 300,
    statusCode: 200,
    route: '/api/webhooks/orders/updated',
  },
  {
    timestamp: at(3000),
    source: 'shopify',
    serviceName: 'webhook-ingest',
    durationMs: 300,
    statusCode: 200,
    route: '/api/webhooks/orders/updated',
  },
  {
    timestamp: at(4000),
    source: 'shopify',
    serviceName: 'webhook-ingest',
    durationMs: 300,
    statusCode: 200,
    route: '/api/webhooks/orders/updated',
  },
  {
    timestamp: at(8000),
    source: 'shopify',
    serviceName: 'webhook-ingest',
    durationMs: 300,
    statusCode: 200,
    route: '/api/webhooks/orders/updated',
  },
  {
    timestamp: at(5000),
    source: 'vercel',
    serviceName: 'cart-api',
    durationMs: 200,
    statusCode: 200,
    route: '/api/cart/sync',
  },
  {
    timestamp: at(5200),
    source: 'vercel',
    serviceName: 'cart-api',
    durationMs: 200,
    statusCode: 200,
    route: '/api/cart/sync',
  },
];

export const DB_TRACE_LOGS: RawLogItem[] = [
  {
    timestamp: at(6000),
    source: 'aws',
    serviceName: 'order-db-query',
    durationMs: 520,
    query: 'SELECT * FROM orders WHERE customer_id = ?',
  },
  {
    timestamp: at(6100),
    source: 'aws',
    serviceName: 'customer-db-query',
    durationMs: 480,
    query: 'SELECT email FROM customers WHERE id IN (...)',
  },
  {
    timestamp: at(6200),
    source: 'aws',
    serviceName: 'inventory-db-query',
    durationMs: 45,
    query: 'SELECT * FROM inventory WHERE sku = ?',
  },
];

for (let i = 0; i < 6; i += 1) {
  DB_TRACE_LOGS.push({
    timestamp: at(7000 + i * 200),
    source: 'vercel',
    serviceName: 'order-item-fetcher',
    durationMs: 80,
    query: 'SELECT * FROM order_items WHERE order_id = ?',
  });
}

for (let i = 0; i < 9; i += 1) {
  DB_TRACE_LOGS.push({
    timestamp: at(8000 + i * 100),
    source: 'aws',
    serviceName: 'account-balance-fetcher',
    durationMs: 60,
    query: 'SELECT balance FROM accounts WHERE id = ?',
  });
}

export const RAW_LOGS_FIXTURE: RawLogItem[] = [
  ...COLD_START_LOGS,
  ...SYNC_LOOP_LOGS,
  ...DB_TRACE_LOGS,
  {
    timestamp: 'not-a-date',
    source: 'aws',
    serviceName: 'unknown-invocation',
  },
];