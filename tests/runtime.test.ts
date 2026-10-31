import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const compose = readFileSync('compose.yaml', 'utf8');
const policy = readFileSync('ngrok/traffic-policy.yml', 'utf8');
// The Shopify Trigger's webhookId (global-constraints.md's fixed IDs). Once workflows/shopify-orders.json
// exists, that file becomes the source of truth and this literal should be read from it instead.
const triggerWebhookId = '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const service = (name: string): string =>
  compose.split(/^ {2}(?=[a-z][\w-]*:$)/m).find((block) => block.startsWith(`${name}:`)) ?? '';

test('images are pinned', () => {
  expect(service('n8n')).toContain('image: n8nio/n8n:2.45.6');
  expect(service('postgres')).toContain('image: postgres:17-alpine');
});
test('n8n never sees the Postgres superuser', () => {
  expect(service('n8n')).toContain('DB_POSTGRESDB_USER: ${N8N_DB_USER}');
  expect(service('n8n')).not.toMatch(/POSTGRES_(USER|PASSWORD)/);
});
test('n8n reads config and data read-only, and workflows read-only', () => {
  expect(service('n8n')).toContain('./config:/files/config:ro');
  expect(service('n8n')).toContain('./data:/files/data:ro');
  expect(service('n8n')).toContain('./workflows:/workflows:ro');
  expect(service('n8n')).toContain('127.0.0.1:5678:5678');
});
test('the tunnel policy pins the Shopify trigger path and denies unsafe encodings', () => {
  expect(policy).toContain(`req.url.raw_path.matches("^/webhook/${triggerWebhookId}/webhook$")`);
  expect(policy).toContain(`req.url.raw_path.contains("%")`);
  expect(policy).toContain(`req.url.raw_path.contains("\\\\")`);
  expect(policy).toContain(`req.url.raw_path.contains("//")`);
  expect(policy).toContain(`req.url.raw_path.contains("/./")`);
  expect(policy).toContain(`req.url.raw_path.contains("/../")`);
  expect(service('ngrok')).toContain('./ngrok/traffic-policy.yml:/etc/ngrok/traffic-policy.yml:ro');
});
test('the webhook allowlist regex only accepts the Shopify trigger path', () => {
  const source = /\.matches\("([^"]+)"\)/.exec(policy)?.[1] ?? '';
  expect(source).toBe(`^/webhook/${triggerWebhookId}/webhook$`);
  // eslint-disable-next-line security/detect-non-literal-regexp -- source is extracted from our own committed traffic policy, not user input
  const allowlist = new RegExp(source);
  expect(allowlist.test(`/webhook/${triggerWebhookId}/webhook`)).toBe(true);
  expect(allowlist.test('/webhook/dev')).toBe(false);
  expect(allowlist.test('/webhook/dev/x')).toBe(false);
  expect(allowlist.test('/webhook/0b5e8f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b/webhook')).toBe(false);
  expect(allowlist.test(`/Webhook/${triggerWebhookId}/webhook`)).toBe(false);
  expect(allowlist.test(`/webhook/${triggerWebhookId}/webhook/extra`)).toBe(false);
  expect(allowlist.test('/rest/login')).toBe(false);
});
