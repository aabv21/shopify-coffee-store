// Signs a fixture order the way Shopify signs a real orders/create webhook, then posts it to the
// local Shopify Trigger. Drives the real, HMAC-checked entry point instead of a dev-harness
// shortcut, so this is the only way to exercise shopify-orders itself before a live store exists.
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/compose.ts';
import { TRIGGER_WEBHOOK_ID } from './lib/manifest.ts';
import type { ShopifyOrderPayload } from '../src/nodes/types.ts';

const ORDER_ID_RE = /^\d+$/;

const API_VERSION = '2026-10';

/** Base64 HMAC-SHA256 of the raw body, exactly as the Shopify Trigger verifies it. */
export function signShopifyBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

/** Stamps a fixture with a fresh order id, keeping every other field the same. */
export function buildTestOrder(fixture: ShopifyOrderPayload, orderId: string): ShopifyOrderPayload {
  return {
    ...fixture,
    id: Number(orderId),
    admin_graphql_api_id: `gid://shopify/Order/${orderId}`,
    name: `#T${orderId}`,
  };
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: string;
}

/** Builds the headers and body the trigger expects. `tamper` signs first, then mutates the body
 * afterward, so the signature header stays valid for the original text but no longer matches what
 * actually gets sent. */
export function buildWebhookRequest(o: { body: string; secret: string; store: string; tamper: boolean }): WebhookRequest {
  const signature = signShopifyBody(o.body, o.secret);
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Topic': 'orders/create',
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Shop-Domain': `${o.store}.myshopify.com`,
      'X-Shopify-API-Version': API_VERSION,
    },
    body: o.tamper ? `${o.body} ` : o.body,
  };
}

/** The Shopify Trigger's fixed webhook path. */
export function webhookUrl(n8nUrl: string): string {
  return `${n8nUrl}/webhook/${TRIGGER_WEBHOOK_ID}/webhook`;
}

/** Reads a flag's value, throwing if the flag is the last argument with nothing after it. */
function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

export function parseArgs(argv: readonly string[]): { fixture: string; orderId: string; tamper: boolean } {
  let fixture = 'below-threshold';
  let orderId = String(Date.now());
  let tamper = false;
  for (let i = 0; i < argv.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i walks argv's own indices, not user-controlled keys
    const arg = argv[i];
    if (arg === undefined) continue; // unreachable while i < argv.length; narrows arg to string below
    if (arg === '--fixture') {
      fixture = readFlagValue(argv, i, '--fixture');
      i += 1;
    } else if (arg === '--order-id') {
      orderId = readFlagValue(argv, i, '--order-id');
      i += 1;
    } else if (arg === '--tamper') {
      tamper = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!ORDER_ID_RE.test(orderId)) throw new Error('--order-id must be all digits');
  return { fixture, orderId, tamper };
}

/** The path to a fixture order, throwing a clear message instead of letting a typo surface as an ENOENT. */
export function fixturePath(fixture: string): string {
  const path = `tests/fixtures/orders/${fixture}.json`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from a CLI argument the operator passes on purpose, not user input
  if (!existsSync(path)) throw new Error(`unknown fixture: ${fixture}`);
  return path;
}

async function main(): Promise<void> {
  loadDotEnv();
  const n8nUrl = process.env.N8N_URL;
  const store = process.env.SHOPIFY_STORE;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!n8nUrl || !store || !secret) throw new Error('N8N_URL, SHOPIFY_STORE, and SHOPIFY_CLIENT_SECRET must all be set in .env');

  const { fixture, orderId, tamper } = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from fixturePath, which only ever reads under tests/fixtures/orders/
  const raw = JSON.parse(readFileSync(fixturePath(fixture), 'utf8')) as ShopifyOrderPayload;
  const order = buildTestOrder(raw, orderId);
  const body = JSON.stringify(order);

  const request = buildWebhookRequest({ body, secret, store, tamper });
  console.log(`order id: ${orderId}`);

  const res = await fetch(webhookUrl(n8nUrl), { method: 'POST', headers: request.headers, body: request.body });
  console.log(`HTTP ${String(res.status)}: ${await res.text()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
