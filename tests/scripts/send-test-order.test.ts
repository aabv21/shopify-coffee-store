import { expect, it } from 'vitest';
import { CANCEL_TRIGGER_WEBHOOK_ID } from '../../scripts/lib/manifest.ts';
import { buildTestOrder, buildWebhookRequest, fixturePath, parseArgs, signShopifyBody, webhookUrl } from '../../scripts/send-test-order.ts';
import { fx } from '../lib/orders.ts';

it('signs the raw body like Shopify', () => expect(signShopifyBody('{"id":1}', 'test-secret')).toBe('H19jdkTt0bdVHJbmH87mtfSa7ud+merMEAWsvbbRGkY='));
it('sends the four headers the trigger requires', () =>
  expect(buildWebhookRequest({ body: '{"id":1}', secret: 'test-secret', store: 'nubandina-demo', tamper: false, topic: 'orders/create' }).headers).toMatchObject({
    'Content-Type': 'application/json', 'X-Shopify-Topic': 'orders/create', 'X-Shopify-Hmac-Sha256': 'H19jdkTt0bdVHJbmH87mtfSa7ud+merMEAWsvbbRGkY=',
    'X-Shopify-Shop-Domain': 'nubandina-demo.myshopify.com', 'X-Shopify-API-Version': '2026-10',
  }));
it('tampering changes the body after signing', () => {
  const r = buildWebhookRequest({ body: '{"id":1}', secret: 'test-secret', store: 'nubandina-demo', tamper: true, topic: 'orders/create' });
  expect(r.headers['X-Shopify-Hmac-Sha256']).toBe('H19jdkTt0bdVHJbmH87mtfSa7ud+merMEAWsvbbRGkY=');
  expect(r.body).not.toBe('{"id":1}');
});
it('stamps the order id', () => {
  const o = buildTestOrder(fx('below-threshold'), '1730000000123');
  expect([o.id, o.admin_graphql_api_id, o.name]).toEqual([1730000000123, 'gid://shopify/Order/1730000000123', '#T1730000000123']);
});
it('targets the fixed trigger path', () => expect(webhookUrl('http://localhost:5678')).toBe('http://localhost:5678/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook'));

it('rejects a non-digit order id', () => expect(() => parseArgs(['--order-id', 'abc'])).toThrow('--order-id must be all digits'));
it('rejects a flag with no value', () => {
  expect(() => parseArgs(['--fixture'])).toThrow('--fixture needs a value');
  expect(() => parseArgs(['--order-id'])).toThrow('--order-id needs a value');
});
it('rejects an unknown argument', () => expect(() => parseArgs(['--bogus'])).toThrow('unknown argument: --bogus'));
it('accepts a well-formed set of arguments', () =>
  expect(parseArgs(['--fixture', 'free-shipping', '--order-id', '123', '--tamper'])).toEqual({ fixture: 'free-shipping', orderId: '123', tamper: true, cancel: false }));
it('rejects an unknown fixture name', () => expect(() => fixturePath('does-not-exist')).toThrow('unknown fixture: does-not-exist'));
it('resolves a real fixture to its path', () => expect(fixturePath('below-threshold')).toBe('tests/fixtures/orders/below-threshold.json'));
it('--cancel signs a cancellation with the orders/cancelled topic and posts it to the cancellation path', () => {
  const { fixture, cancel } = parseArgs(['--cancel']);
  expect([fixture, cancel]).toEqual(['cancelled', true]);
  const r = buildWebhookRequest({ body: '{"id":1}', secret: 'test-secret', store: 'nubandina-demo', tamper: false, topic: 'orders/cancelled' });
  expect(r.headers['X-Shopify-Topic']).toBe('orders/cancelled');
  expect(r.headers['X-Shopify-Hmac-Sha256']).toBe('H19jdkTt0bdVHJbmH87mtfSa7ud+merMEAWsvbbRGkY=');
  expect(webhookUrl('http://localhost:5678', CANCEL_TRIGGER_WEBHOOK_ID)).toBe(`http://localhost:5678/webhook/${CANCEL_TRIGGER_WEBHOOK_ID}/webhook`);
});
it('--cancel stamps the same #T order number as the order', () => {
  const o = buildTestOrder(fx('cancelled'), '1730000000123');
  expect([o.id, o.admin_graphql_api_id, o.name, o.cancelled_at]).toEqual([1730000000123, 'gid://shopify/Order/1730000000123', '#T1730000000123', '2026-11-04T14:20:00Z']);
});
it('an explicit fixture wins over the --cancel default', () => expect(parseArgs(['--cancel', '--fixture', 'two-methods']).fixture).toBe('two-methods'));
