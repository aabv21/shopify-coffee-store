import { expect, it } from 'vitest';
import { run } from '../../src/nodes/normalize-order.ts';
import { fx } from '../lib/orders.ts';

it('normalizes an order with two coffees', () => expect(run(fx('two-methods'))).toEqual({
  order_id: '7000000004', order_number: '#T1004', created_at: '2026-11-04T15:20:00-05:00',
  email: 'pedro.diaz@example.com', first_name: 'Pedro', customer_name: 'Pedro Diaz', city: 'Barranquilla',
  currency: 'COP', subtotal: 84000, shipping: 12000, total: 96000, free_shipping: false,
  lines: [
    { variant_id: '1001', variant_gid: 'gid://shopify/ProductVariant/1001', product_title: 'Nariño', variant_title: '250 g', sku: 'NBC-NAR-250', quantity: 1 },
    { variant_id: '3001', variant_gid: 'gid://shopify/ProductVariant/3001', product_title: 'Sierra Nevada', variant_title: '250 g', sku: 'NBC-SNV-250', quantity: 1 },
  ],
  variant_gids: ['gid://shopify/ProductVariant/1001', 'gid://shopify/ProductVariant/3001'],
}));
it('marks free shipping only when a shipping line costs nothing', () =>
  expect(['free-shipping', 'below-threshold', 'guest-no-email'].map((n) => run(fx(n)).free_shipping)).toEqual([true, false, false]));
it('handles a guest order with no email, no addresses, and a custom item', () => {
  const o = run(fx('guest-no-email'));
  expect([o.email, o.first_name, o.customer_name, o.city]).toEqual([null, null, '', '']);
  expect(o.lines[0]).toEqual({ variant_id: null, variant_gid: null, product_title: 'Gift wrap', variant_title: null, sku: null, quantity: 1 });
  expect(o.variant_gids).toEqual(['gid://shopify/ProductVariant/2001']);
});
it('takes the id from admin_graphql_api_id so large ids keep their digits', () =>
  expect(run({ ...fx('below-threshold'), id: 9007199254740992, admin_graphql_api_id: 'gid://shopify/Order/9007199254740993' }).order_id).toBe('9007199254740993'));
it('falls back to String(id) when admin_graphql_api_id is absent', () => {
  const o: Record<string, unknown> = { ...fx('below-threshold') };
  delete o.admin_graphql_api_id;
  expect(run({ ...(o as unknown as ReturnType<typeof fx>), id: 7000000099 }).order_id).toBe('7000000099');
});
it('rejects a payload with no id at all', () => {
  const o: Record<string, unknown> = { ...fx('below-threshold') };
  delete o.admin_graphql_api_id;
  delete o.id;
  expect(() => run(o as unknown as ReturnType<typeof fx>)).toThrow('Order payload has no id');
});
it('rejects a payload without an order number', () => {
  const o: Record<string, unknown> = { ...fx('below-threshold') };
  delete o.name;
  expect(() => run(o as unknown as ReturnType<typeof fx>)).toThrow('Order payload has no order number');
});
it('lists a repeated variant once', () => {
  const o = fx('low-stock');
  const lineItems = o.line_items ?? [];
  expect(run({ ...o, line_items: [...lineItems, ...lineItems] }).variant_gids).toEqual(['gid://shopify/ProductVariant/3002']);
});
it('rejects a payload without line items', () => expect(() => run({ ...fx('below-threshold'), line_items: [] })).toThrow('Order payload has no line items'));
it('rejects a payload with no line_items key at all', () => {
  const o: Record<string, unknown> = { ...fx('below-threshold') };
  delete o.line_items;
  expect(() => run(o as unknown as ReturnType<typeof fx>)).toThrow('Order payload has no line items');
});

it('falls back to the sum of shipping lines when total_shipping_price_set is missing', () => {
  const o: Record<string, unknown> = { ...fx('below-threshold') };
  delete o.total_shipping_price_set;
  expect(run(o as unknown as ReturnType<typeof fx>).shipping).toBe(12000);
});
it('falls back to the sum of shipping lines when shop_money.amount is missing', () => {
  const o = fx('two-methods');
  expect(run({ ...o, total_shipping_price_set: {} }).shipping).toBe(12000);
});
it('throws when no shipping amount can be read and shipping lines exist', () => {
  const o = fx('below-threshold');
  expect(() => run({ ...o, total_shipping_price_set: {}, shipping_lines: [{ title: 'Standard shipping' }] })).toThrow('Order payload has an invalid amount');
});
it('throws when an amount is not finite', () => expect(() => run({ ...fx('below-threshold'), subtotal_price: 'not-a-number' })).toThrow('Order payload has an invalid amount'));
it('throws on a null or empty subtotal or total instead of treating it as 0', () => {
  expect(() => run({ ...fx('below-threshold'), subtotal_price: null as unknown as string })).toThrow('Order payload has an invalid amount');
  expect(() => run({ ...fx('below-threshold'), subtotal_price: '' })).toThrow('Order payload has an invalid amount');
  expect(() => run({ ...fx('below-threshold'), total_price: null as unknown as string })).toThrow('Order payload has an invalid amount');
  expect(() => run({ ...fx('below-threshold'), total_price: '' })).toThrow('Order payload has an invalid amount');
});
it('falls back to shipping lines when shop_money.amount is null or empty, instead of treating it as 0', () => {
  expect(run({ ...fx('below-threshold'), total_shipping_price_set: { shop_money: { amount: null as unknown as string } } }).shipping).toBe(12000);
  expect(run({ ...fx('below-threshold'), total_shipping_price_set: { shop_money: { amount: '' } } }).shipping).toBe(12000);
});

it('treats an email containing a comma, whitespace, ;, < or > as no address, so it can\'t add a recipient', () => {
  for (const email of ['a@example.com,b@example.com', 'a @example.com', 'a@example.com;b@example.com', '<a@example.com>', 'a@example.com\tb@example.com']) {
    expect(run({ ...fx('below-threshold'), email }).email).toBeNull();
  }
});
it('still accepts an ordinary email with no comma, whitespace, ;, < or >', () =>
  expect(run({ ...fx('below-threshold'), email: 'plain@example.com' }).email).toBe('plain@example.com'));
it('throws when a shipping line price is null or empty', () => {
  expect(() => run({ ...fx('below-threshold'), total_shipping_price_set: {}, shipping_lines: [{ title: 'Standard shipping', price: null as unknown as string }] }))
    .toThrow('Order payload has an invalid amount');
  expect(() => run({ ...fx('below-threshold'), total_shipping_price_set: {}, shipping_lines: [{ title: 'Standard shipping', price: '' }] }))
    .toThrow('Order payload has an invalid amount');
});
