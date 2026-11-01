import { expect, it } from 'vitest';
import { run } from '../../src/nodes/order-row.ts';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { fx } from '../lib/orders.ts';

const order = (n: string) => normalize(fx(n));

it('maps the free-shipping order to the sheet row', () => expect(run({ order: order('free-shipping') })).toEqual({
  date: '2026-11-04 10:15', order_number: '#T1002', customer: 'Carlos Ruiz', city: 'Bogotá',
  products: 'Huila (250 g) x 1; Huila (500 g) x 1', units: 2, subtotal: 120000, shipping: 0, total: 120000, free_shipping: 'yes',
}));
it('converts UTC timestamps to Bogota time', () =>
  expect(run({ order: { ...order('below-threshold'), created_at: '2026-11-05T00:30:00Z' } }).date).toBe('2026-11-04 19:30'));
it('lists items without a variant title by product title only', () =>
  expect(run({ order: order('guest-no-email') }).products).toBe('Gift wrap x 1; Huila (250 g) x 1'));
it('passes customer text through unchanged; the sheet node writes it raw', () =>
  expect(run({ order: { ...order('below-threshold'), customer_name: '=HYPERLINK("http://x")' } }).customer).toBe('=HYPERLINK("http://x")'));
