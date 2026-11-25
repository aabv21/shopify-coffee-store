import { expect, it } from 'vitest';
import { run } from '../../src/nodes/cancel-notice.ts';
import { runCodeNode } from '../lib/code-node.ts';

const base = { order_number: '#T1001', cancelled_at: '2026-11-04T14:20:00Z', cancel_reason: 'customer' };

it('writes the English notice with the Bogota time and a readable reason', () =>
  expect(run({ cancellation: base, team_locale: 'en' })).toEqual({
    subject: 'Order #T1001 cancelled',
    text: [
      'Order #T1001 was cancelled in Shopify.',
      'Reason: customer request',
      'Cancelled at: 2026-11-04 09:20 America/Bogota',
      'Its Orders row now reads "cancelled". No brewing guide or reorder reminder goes out for it from now on.',
    ].join('\n'),
  }));

it('writes the Spanish notice when team_locale is es', () =>
  expect(run({ cancellation: base, team_locale: 'es' })).toEqual({
    subject: 'Pedido #T1001 cancelado',
    text: [
      'El pedido #T1001 se canceló en Shopify.',
      'Motivo: solicitud del cliente',
      'Cancelado el: 2026-11-04 09:20 America/Bogota',
      'Su fila en Orders ahora dice "cancelled". A partir de ahora no se enviará la guía de preparación ni el recordatorio de recompra.',
    ].join('\n'),
  }));

it('names every Shopify reason in both languages', () => {
  const reasons = ['customer', 'fraud', 'inventory', 'declined', 'staff', 'other'];
  const en = reasons.map((r) => run({ cancellation: { ...base, cancel_reason: r } }).text.split('\n')[1]);
  expect(en).toEqual(['Reason: customer request', 'Reason: fraud', 'Reason: out of stock', 'Reason: payment declined', 'Reason: staff error', 'Reason: other']);
  const es = reasons.map((r) => run({ cancellation: { ...base, cancel_reason: r }, team_locale: 'es' }).text.split('\n')[1]);
  expect(es).toEqual(['Motivo: solicitud del cliente', 'Motivo: fraude', 'Motivo: sin inventario', 'Motivo: pago rechazado', 'Motivo: error del personal', 'Motivo: otro']);
});

it('a blank reason reads "not given", and an unknown reason prints as is', () => {
  expect(run({ cancellation: { ...base, cancel_reason: '' } }).text).toContain('Reason: not given');
  expect(run({ cancellation: { ...base, cancel_reason: '' }, team_locale: 'es' }).text).toContain('Motivo: no indicado');
  expect(run({ cancellation: { ...base, cancel_reason: 'weather' } }).text).toContain('Reason: weather');
});

it('a bad time reads "unknown" and never throws', () => {
  expect(run({ cancellation: { ...base, cancelled_at: 'not a date' } }).text).toContain('Cancelled at: unknown America/Bogota');
  expect(run({ cancellation: { ...base, cancelled_at: '' }, team_locale: 'es' }).text).toContain('Cancelado el: desconocida America/Bogota');
});

it('a line break in the order number never reaches the subject', () => {
  const out = run({ cancellation: { ...base, order_number: '#T1\r\nBcc: x' } });
  expect(out.subject).toBe('Order #T1 Bcc: x cancelled');
  expect(out.subject).not.toMatch(/[\r\n]/);
});

it('falls back to English for a locale it does not speak', () =>
  expect(run({ cancellation: base, team_locale: 'fr' }).subject).toBe('Order #T1001 cancelled'));

it('has every message in both languages, none empty', () => {
  for (const team_locale of ['en', 'es']) {
    const out = run({ cancellation: { ...base, cancel_reason: '' }, team_locale });
    expect(out.subject).not.toBe('');
    for (const line of out.text.split('\n')) expect(line.trim()).not.toBe('');
  }
});

it('the committed Build cancellation notice jsCode gives the same notice in the Code-node sandbox', () => {
  for (const team_locale of ['en', 'es']) {
    const input = { cancellation: base, team_locale };
    expect(runCodeNode('cancel-order.json', 'Build cancellation notice', input)).toEqual([{ json: run(input) }]);
  }
});
