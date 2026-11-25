import { expect, it } from 'vitest';
import { run, type ReorderReminderInput } from '../../src/nodes/reorder-reminder.ts';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import type { VariantInfo } from '../../src/nodes/types.ts';
import { runCodeNode } from '../lib/code-node.ts';
import { fx } from '../lib/orders.ts';

const variant = (id: number, product: string, size: string): VariantInfo => ({
  variant_gid: `gid://shopify/ProductVariant/${String(id)}`, product_title: product, variant_title: size, sku: null, tracked: true, available: 20, roast: 'light', brew_method: 'pour-over',
});
const VARIANTS = [variant(1001, 'Nariño', '250 g'), variant(3001, 'Sierra Nevada', '250 g')];
const status = { cancelled: false, reordered: false, recorded: true };
const input = (patch: Partial<ReorderReminderInput> = {}): ReorderReminderInput => ({ order: normalize(fx('two-methods')), variants: VARIANTS, status, store: 'nubandina-demo', days: 21, ...patch });

it('sends the reminder to a consenting customer', () => {
  const r = run(input());
  expect(r).toMatchObject({ send: true, reason: 'sent', to: 'pedro.diaz@example.com', subject: 'Time to restock your coffee?' });
  expect(r.html).toContain('Hi Pedro,');
  expect(r.html).toContain("It's been about 21 days since your order #T1004.");
  expect(r.html).toContain('<li>Nariño (250 g) × 1</li>');
  expect(r.html).toContain('Reorder the same bags');
  expect(r.html).toContain('You&#39;re getting this email because you agreed to marketing emails at checkout.');
  expect(r.html).toContain('Don&#39;t want these? Reply to this email and we&#39;ll stop.');
});

it('no reminder without marketing consent: false, null, or missing', () => {
  const order = normalize(fx('two-methods'));
  expect(run(input({ order: normalize(fx('below-threshold')) }))).toMatchObject({ send: false, reason: 'no_consent', to: null });
  for (const accepts_marketing of [false, null, undefined]) {
    const consent = { ...order, accepts_marketing } as unknown as ReorderReminderInput['order'];
    expect(run(input({ order: consent })), String(accepts_marketing)).toMatchObject({ send: false, reason: 'no_consent' });
  }
  // An order recorded before the field existed has no consent at all.
  const older: Record<string, unknown> = { ...order };
  delete older.accepts_marketing;
  expect(run(input({ order: older as unknown as ReorderReminderInput['order'] })).reason).toBe('no_consent');
  expect(run(input({ order: { ...order, accepts_marketing: 'true' as unknown as boolean } })).reason).toBe('no_consent');
});

it('no reminder without an email address', () =>
  expect(run(input({ order: { ...normalize(fx('two-methods')), email: null } }))).toMatchObject({ send: false, reason: 'no_email' }));

it('no reminder for a cancelled order', () => expect(run(input({ status: { cancelled: true, reordered: false, recorded: true } }))).toMatchObject({ send: false, reason: 'cancelled' }));

it('no reminder after a reorder', () => expect(run(input({ status: { cancelled: false, reordered: true, recorded: true } }))).toMatchObject({ send: false, reason: 'reordered' }));

it('no reminder for an erased order: it is no longer recorded, so nothing else about it can be trusted', () => {
  expect(run(input({ status: { cancelled: false, reordered: false, recorded: false } }))).toMatchObject({ send: false, reason: 'not_recorded', to: null });
  // Not recorded wins over cancelled and reordered, which an erasure would have cleared anyway.
  expect(run(input({ status: { cancelled: true, reordered: true, recorded: false } })).reason).toBe('not_recorded');
});

it('no reminder for a guest: without a customer id nothing could tell it the customer already reordered', () => {
  const guest = { ...normalize(fx('two-methods')), customer_id: null };
  expect(guest.accepts_marketing).toBe(true);
  expect(run(input({ order: guest }))).toMatchObject({ send: false, reason: 'no_customer', to: null });
  const older: Record<string, unknown> = { ...normalize(fx('two-methods')) };
  delete older.customer_id;
  expect(run(input({ order: older as unknown as ReorderReminderInput['order'] })).reason).toBe('no_customer');
});

it('checks consent before everything else, then the customer, the email, the record, cancellation and reorder in order', () => {
  const guestNoConsent = { ...normalize(fx('two-methods')), accepts_marketing: false, email: null };
  expect(run(input({ order: guestNoConsent, status: { cancelled: true, reordered: true, recorded: true } })).reason).toBe('no_consent');
  expect(run(input({ order: { ...normalize(fx('two-methods')), customer_id: null, email: null }, status: { cancelled: true, reordered: true, recorded: false } })).reason).toBe('no_customer');
  expect(run(input({ order: { ...normalize(fx('two-methods')), email: null }, status: { cancelled: true, reordered: true, recorded: false } })).reason).toBe('no_email');
  expect(run(input({ status: { cancelled: true, reordered: true, recorded: false } })).reason).toBe('not_recorded');
  expect(run(input({ status: { cancelled: true, reordered: true, recorded: true } })).reason).toBe('cancelled');
});

it("no reminder when none of the order's bags was in the stock read at order time", () => {
  expect(run(input({ variants: [] }))).toMatchObject({ send: false, reason: 'no_known_variant' });
  expect(run(input({ store: 'not a store' }))).toMatchObject({ send: false, reason: 'no_known_variant' });
  expect(run(input({ store: '' })).reason).toBe('no_known_variant');
});

it('the reminder links a cart with the same bags and quantities', () => {
  expect(run(input()).html).toContain('href="https://nubandina-demo.myshopify.com/cart/1001:1,3001:1"');
  const order = normalize(fx('two-methods'));
  const two = { ...order, lines: order.lines.map((l, i) => (i === 0 ? { ...l, quantity: 3 } : l)) };
  expect(run(input({ order: two })).html).toContain('/cart/1001:3,3001:1"');
  // A line whose variant is gone drops out of both the list and the link.
  const html = run(input({ variants: [VARIANTS[1] as VariantInfo] })).html;
  expect(html).toContain('/cart/3001:1"');
  expect(html).not.toContain('Nariño');
});

it('says "a day" for one day and "N days" otherwise, in both languages', () => {
  const en = (days: number) => run(input({ days })).html;
  expect(en(1)).toContain("It&#39;s been a day since your order #T1004.".replace('&#39;', "'"));
  expect(en(1)).not.toContain('1 days');
  expect(en(2)).toContain("It's been about 2 days since your order");
  const es = (days: number) => run(input({ days, order: { ...normalize(fx('two-methods')), locale: 'es' } })).html;
  expect(es(1)).toContain('Ha pasado un día desde su pedido #T1004.');
  expect(es(1)).not.toContain('1 días');
  expect(es(21)).toContain('Han pasado unos 21 días desde su pedido');
});

it('writes the Spanish reminder for an es order', () => {
  const es = run(input({ order: { ...normalize(fx('two-methods-es')), email: 'lucia@example.com' } }));
  expect(es.subject).toBe('¿Es hora de reponer su café?');
  expect(es.html).toContain('lang="es"');
  expect(es.html).toContain('Hola, Lucía:');
  expect(es.html).toContain('Han pasado unos 21 días desde su pedido');
  expect(es.html).toContain('Volver a pedir lo mismo');
  expect(es.html).toContain('Le enviamos este correo porque al pagar aceptó recibir nuestras novedades.');
  expect(es.html).toContain('¿No desea recibirlos? Responda a este correo y no le enviaremos más.');
});

it('uses the default locale when the order has none', () => {
  const order = { ...normalize(fx('two-methods')), locale: null };
  expect(run(input({ order, default_locale: 'es' })).subject).toBe('¿Es hora de reponer su café?');
  expect(run(input({ order, default_locale: '' })).subject).toBe('Time to restock your coffee?');
});

it('greets without a name when the order has none', () => {
  expect(run(input({ order: { ...normalize(fx('two-methods')), first_name: null } })).html).toContain('Hi there,');
});

it('escapes the first name and product titles', () => {
  const html = run(input({ order: { ...normalize(fx('two-methods')), first_name: '<b>Pedro</b>' }, variants: [{ ...(VARIANTS[0] as VariantInfo), product_title: 'Nariño & <i>Co</i>' }, VARIANTS[1] as VariantInfo] })).html;
  expect(html).toContain('Hi &lt;b&gt;Pedro&lt;/b&gt;,');
  expect(html).toContain('Nariño &amp; &lt;i&gt;Co&lt;/i&gt;');
  expect(html).not.toContain('<b>Pedro</b>');
});

it('has every message in both languages, none empty', () => {
  for (const locale of ['en', 'es'] as const) {
    const r = run(input({ order: { ...normalize(fx('two-methods')), locale } }));
    expect(r.subject).not.toBe('');
    expect(r.html).not.toMatch(/undefined|\[object/);
  }
  expect(run(input({ order: { ...normalize(fx('two-methods')), locale: 'en' } })).subject).not.toBe(run(input({ order: { ...normalize(fx('two-methods')), locale: 'es' } })).subject);
});

it('the committed jsCode gives the same reminder in the Code-node sandbox', () => {
  for (const order of [normalize(fx('two-methods')), normalize(fx('two-methods-es')), normalize(fx('below-threshold'))]) {
    const i = input({ order });
    expect(runCodeNode('reorder-reminder.json', 'Build reorder reminder', i)).toEqual([{ json: run(i) }]);
  }
});
