import { afterEach, expect, test, vi } from 'vitest';
import { isWebhookLive, waitForHealthy, waitForWebhookLive } from '../../scripts/lib/health.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('isWebhookLive treats 404 as not yet registered', () => expect(isWebhookLive(404)).toBe(false));
test('isWebhookLive treats 403 (the dev harness rejecting an unauthenticated call) as live', () => expect(isWebhookLive(403)).toBe(true));
test('isWebhookLive treats any other status as live too', () => {
  expect(isWebhookLive(200)).toBe(true);
  expect(isWebhookLive(500)).toBe(true);
});

// A fake fetch standing in for n8n's /healthz or webhook endpoint, so the polls' timing and
// decision logic are provable with no real network and no live stack.
function fakeFetch(statuses: readonly number[]): typeof fetch {
  let call = 0;
  return ((): Promise<Pick<Response, 'status' | 'ok'>> => {
    const status = statuses[Math.min(call, statuses.length - 1)] ?? 404;
    call += 1;
    return Promise.resolve({ status, ok: status >= 200 && status < 300 });
  }) as unknown as typeof fetch;
}

test('waitForHealthy returns true right away when the first poll is already healthy', async () => {
  vi.stubGlobal('fetch', fakeFetch([200]));
  expect(await waitForHealthy('http://n8n.test', 5000)).toBe(true);
});
test('waitForHealthy returns false when the budget elapses while every poll fails', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
  expect(await waitForHealthy('http://n8n.test', 0)).toBe(false);
});

test('waitForWebhookLive returns true right away when the first poll is already live', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 5000, fakeFetch([403]))).toBe(true);
});
test('waitForWebhookLive returns true once a run of 404s turns live within the budget', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 5000, fakeFetch([404, 404, 403]))).toBe(true);
});
test('waitForWebhookLive returns false when the budget elapses while every poll still answers 404', async () => {
  expect(await waitForWebhookLive('http://n8n.test', 'dev', 0, fakeFetch([404]))).toBe(false);
});
test('waitForWebhookLive polls the given path under /webhook/ with an unauthenticated POST', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve({ status: 403 } as Response);
  }) as unknown as typeof fetch;
  await waitForWebhookLive('http://n8n.test', 'dev', 5000, fetchImpl);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toBe('http://n8n.test/webhook/dev');
  expect(calls[0]?.[1]?.method).toBe('POST');
});
