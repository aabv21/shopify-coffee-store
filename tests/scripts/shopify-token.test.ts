import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  checkScopes,
  exchangeCode,
  parseCallbackUrl,
  requestClientCredentialsToken,
  shopDomain,
  upsertEnv,
  writeEnvFile,
} from '../../scripts/shopify-token.ts';

const signed = 'https://127.0.0.1/shopify/callback?code=abc123&hmac=1b041e94145574841302b5da8dacf0dcbfee720ec48859156a75bc4e50ef02c0&shop=nubandina-demo.myshopify.com&state=s1&timestamp=1793000000';
const opts = { store: 'nubandina-demo', state: 's1', clientSecret: 'test-secret' };
const reply = (status: number, body: unknown, calls: { url: string; body: string }[] = []) =>
  // eslint-disable-next-line @typescript-eslint/require-await -- matches the real fetch signature, which the cast below requires
  (async (url: string | URL | Request, init?: RequestInit) => {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- url and init.body are always a string, URL, or Request here, never a plain object
    calls.push({ url: String(url), body: String(init?.body) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

it('builds the authorize URL for an offline token with the three read scopes', () => {
  const url = new URL(buildAuthorizeUrl({ store: 'nubandina-demo', clientId: 'cid', state: 's1' }));
  expect(url.origin + url.pathname).toBe('https://nubandina-demo.myshopify.com/admin/oauth/authorize');
  expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'cid', scope: 'read_orders,read_products,read_inventory', redirect_uri: 'https://127.0.0.1/shopify/callback', state: 's1' });
});
it('accepts a correctly signed callback', () => expect(parseCallbackUrl(signed, opts)).toBe('abc123'));
it('rejects a tampered callback', () => expect(() => parseCallbackUrl(signed.replace('abc123', 'abc124'), opts)).toThrow(/hmac/i));
it('rejects another state', () => expect(() => parseCallbackUrl(signed, { ...opts, state: 's2' })).toThrow(/state/i));
it('rejects another shop', () => expect(() => parseCallbackUrl(signed, { ...opts, store: 'other-shop' })).toThrow(/shop/i));
it('accepts a signed callback whose base64 host param needs form encoding', () => {
  const signedWithHost = 'https://127.0.0.1/shopify/callback?code=abc123&hmac=b8c05d14a04fddd65d4894112da3e471bf3be281ea6c9d99219e4099ff5721fb&host=bnViYW5kaW5hLWRlbW8ubXlzaG9waWZ5LmNvbS9hZG1pbg%3D%3D&shop=nubandina-demo.myshopify.com&state=s1&timestamp=1793000000';
  expect(parseCallbackUrl(signedWithHost, opts)).toBe('abc123');
});
it('rejects store values that are not a subdomain', () => expect(() => shopDomain('evil.com/x')).toThrow(/store must be the myshopify subdomain/));
it('exchanges the code with a form post and reports a non-expiring token', async () => {
  const calls: { url: string; body: string }[] = [];
  expect(await exchangeCode({ store: 'nubandina-demo', clientId: 'cid', clientSecret: 'sec', code: 'abc123' },
    reply(200, { access_token: 'tok', scope: 'read_orders,read_products,read_inventory' }, calls)))
    .toEqual({ accessToken: 'tok', scopes: ['read_orders', 'read_products', 'read_inventory'], expiresIn: null });
  expect(calls[0]?.url).toBe('https://nubandina-demo.myshopify.com/admin/oauth/access_token');
  const form = new URLSearchParams(calls[0]?.body);
  expect([form.get('client_id'), form.get('code'), form.has('expiring')]).toEqual(['cid', 'abc123', false]);
});
it('reports the 24-hour expiry of client-credentials tokens', async () =>
  expect((await requestClientCredentialsToken({ store: 'nubandina-demo', clientId: 'cid', clientSecret: 'sec' },
    reply(200, { access_token: 'tok', scope: 'read_orders', expires_in: 86399 }))).expiresIn).toBe(86399));
it('fails on an error response without echoing the secret', async () => {
  const err = await exchangeCode({ store: 'nubandina-demo', clientId: 'cid', clientSecret: 'sec-value', code: 'x' }, reply(401, { error: 'invalid_client' })).catch((e: unknown) => e);
  expect(String(err)).toMatch(/401/);
  expect(String(err)).not.toContain('sec-value');
});
it('requires exactly the three read scopes', () => {
  expect(() => checkScopes(['read_orders', 'read_products'])).toThrow(/missing read_inventory/);
  expect(() => checkScopes(['read_orders', 'read_products', 'read_inventory', 'write_orders'])).toThrow(/extra write_orders/);
  expect(() => checkScopes(['read_inventory', 'read_orders', 'read_products'])).not.toThrow();
});
it('updates or appends a key in .env text', () => {
  expect(upsertEnv('A=1\nSHOPIFY_ACCESS_TOKEN=\nB=2\n', 'SHOPIFY_ACCESS_TOKEN', 'tok')).toBe('A=1\nSHOPIFY_ACCESS_TOKEN=tok\nB=2\n');
  expect(upsertEnv('A=1\n', 'K', 'v')).toBe('A=1\nK=v\n');
});
it('writes .env atomically at mode 0600, even starting from a looser mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nbc-env-'));
  const path = join(dir, '.env');
  writeFileSync(path, 'A=1\n', { mode: 0o644 });
  writeEnvFile(path, 'A=1\nSHOPIFY_ACCESS_TOKEN=tok\n');
  expect(readFileSync(path, 'utf8')).toBe('A=1\nSHOPIFY_ACCESS_TOKEN=tok\n');
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
it('writes .env atomically even when a stale, looser-mode tmp file is left over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nbc-env-'));
  const path = join(dir, '.env');
  writeFileSync(path, 'A=1\n', { mode: 0o644 });
  writeFileSync(`${path}.tmp`, 'stale', { mode: 0o644 });
  chmodSync(`${path}.tmp`, 0o644);
  writeEnvFile(path, 'A=1\nSHOPIFY_ACCESS_TOKEN=tok\n');
  expect(readFileSync(path, 'utf8')).toBe('A=1\nSHOPIFY_ACCESS_TOKEN=tok\n');
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
