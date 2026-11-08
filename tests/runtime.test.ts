import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { TRIGGER_WEBHOOK_ID } from '../scripts/lib/manifest.ts';

const compose = readFileSync('compose.yaml', 'utf8');
const policy = readFileSync('ngrok/traffic-policy.yml', 'utf8');
const triggerWebhookId = TRIGGER_WEBHOOK_ID;
const service = (name: string): string =>
  compose.split(/^ {2}(?=[a-z][\w-]*:$)/m).find((block) => block.startsWith(`${name}:`)) ?? '';

test('images are pinned', () => {
  // Patches on the 2.45 line arrive through Dependabot; a minor or major move is a deliberate change.
  expect(service('n8n')).toMatch(/image: n8nio\/n8n:2\.45\.\d+@sha256:[0-9a-f]{64}/);
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
test('n8n caps its payload size well above a real Shopify order but well below the default', () => {
  expect(service('n8n')).toContain('N8N_PAYLOAD_SIZE_MAX: "2"');
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
test('the tunnel disables request inspection, since captured requests hold order PII', () => {
  expect(service('ngrok')).toContain('--inspect=false');
});
test('the tunnel policy rate-limits by client IP, well above a small store\'s delivery rate', () => {
  expect(policy).toContain('type: rate-limit');
  expect(policy).toContain('algorithm: sliding_window');
  expect(policy).toContain('capacity: 60');
  expect(policy).toContain('rate: 60s');
  expect(policy).toContain('- conn.client_ip');
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
