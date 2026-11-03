import { expect, it } from 'vitest';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { run as buildOrderRow } from '../../src/nodes/order-row.ts';
import { run } from '../../src/nodes/owner-summary.ts';
import { fx } from '../lib/orders.ts';

const row = (n: string) => buildOrderRow({ order: normalize(fx(n)) });

it('summarizes the order in English, exactly as the owner email always read', () =>
  expect(run({ row: row('two-methods'), team_locale: 'en' })).toEqual({
    subject: 'New order #T1004: 96,000 COP',
    text: [
      'Order: #T1004',
      'Date: 2026-11-04 15:20',
      'Customer: Pedro Diaz',
      'City: Barranquilla',
      'Products: Nariño (250 g) x 1; Sierra Nevada (250 g) x 1',
      'Units: 2',
      'Subtotal: 84,000 COP',
      'Shipping: 12,000 COP',
      'Total: 96,000 COP',
      'Free shipping: no',
    ].join('\n'),
  }));

it("summarizes the order in Spanish, with Colombia's own digit grouping", () =>
  expect(run({ row: row('free-shipping'), team_locale: 'es' })).toEqual({
    subject: 'Nuevo pedido #T1002: 120.000 COP',
    text: [
      'Pedido: #T1002',
      `Fecha: ${row('free-shipping').date}`,
      'Cliente: Carlos Ruiz',
      `Ciudad: ${row('free-shipping').city}`,
      `Productos: ${row('free-shipping').products}`,
      `Unidades: ${String(row('free-shipping').units)}`,
      'Subtotal: 120.000 COP',
      'Envío: 0 COP',
      'Total: 120.000 COP',
      'Envío gratis: sí',
    ].join('\n'),
  }));

it("follows the team's locale, not the customer's", () =>
  expect(run({ row: row('two-methods-es'), team_locale: 'en' }).subject).toBe('New order #T1006: 96,000 COP'));

it('writes English for a blank, missing, or unknown team locale', () => {
  expect(run({ row: row('two-methods') }).subject).toBe('New order #T1004: 96,000 COP');
  expect(run({ row: row('two-methods'), team_locale: '' }).subject).toBe('New order #T1004: 96,000 COP');
  expect(run({ row: row('two-methods'), team_locale: 'pt-BR' }).subject).toBe('New order #T1004: 96,000 COP');
});

it('keeps decimals an amount actually has', () =>
  expect(run({ row: { ...row('two-methods'), total: 1234.5 }, team_locale: 'es' }).subject).toBe('Nuevo pedido #T1004: 1.234,5 COP'));
