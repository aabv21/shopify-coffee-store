import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { run } from '../../src/nodes/select-low-stock.ts';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { fx } from '../lib/orders.ts';

const stock = (n: string): unknown => JSON.parse(readFileSync(`tests/fixtures/stock/${n}.json`, 'utf8'));
const order = (n: string) => normalize(fx(n));

it('flags a variant that falls below the threshold', () => {
  const r = run({ order: order('low-stock'), response: stock('sierra-500-at-4'), threshold: 5 });
  expect(r.low_stock).toEqual([{ product_title: 'Sierra Nevada', variant_title: '500 g', sku: 'NBC-SNV-500', available: 4 }]);
  expect([r.subject, r.text]).toEqual(['Low stock after order #T1003', 'Sierra Nevada (500 g), SKU NBC-SNV-500: 4 left (threshold 5)']);
});
it('does not flag stock exactly at the threshold', () =>
  expect(run({ order: order('low-stock'), response: stock('sierra-500-at-5'), threshold: 5 }).low_stock).toEqual([]));
it('skips untracked variants and variants Shopify no longer has', () => {
  const r = run({ order: order('two-methods'), response: stock('untracked-and-missing'), threshold: 5 });
  expect(r.low_stock).toEqual([]);
  expect(r.variants.map((v) => v.variant_gid)).toEqual(['gid://shopify/ProductVariant/1001']);
});
it('reports a variant once even when it appears on two lines', () => {
  const o = order('low-stock');
  expect(run({ order: { ...o, lines: [...o.lines, ...o.lines] }, response: stock('sierra-500-at-4'), threshold: 5 }).low_stock).toHaveLength(1);
});
it('returns roast and brew method for every known variant', () =>
  expect(run({ order: order('two-methods'), response: stock('two-methods'), threshold: 5 }).variants).toEqual([
    { variant_gid: 'gid://shopify/ProductVariant/1001', product_title: 'Nariño', variant_title: '250 g', sku: 'NBC-NAR-250', tracked: true, available: 39, roast: 'light', brew_method: 'pour-over' },
    { variant_gid: 'gid://shopify/ProductVariant/3001', product_title: 'Sierra Nevada', variant_title: '250 g', sku: 'NBC-SNV-250', tracked: true, available: 39, roast: 'dark', brew_method: 'espresso' },
  ]));
it('fails loudly on GraphQL errors', () =>
  expect(() => run({ order: order('two-methods'), response: { errors: [{ message: 'Throttled' }] }, threshold: 5 })).toThrow('Shopify GraphQL error: Throttled'));
it.each([{}, { data: {} }, { data: null }])('fails loudly on a malformed response %j', (response) =>
  expect(() => run({ order: order('two-methods'), response, threshold: 5 })).toThrow('Shopify GraphQL response has no nodes'));
it('treats a genuinely empty nodes array as no known variants, not an error', () => {
  const r = run({ order: order('two-methods'), response: { data: { nodes: [] } }, threshold: 5 });
  expect([r.variants, r.low_stock]).toEqual([[], []]);
});
