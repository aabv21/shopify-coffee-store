import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { run } from '../../src/nodes/select-guides.ts';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { run as selectStock } from '../../src/nodes/select-low-stock.ts';
import type { BrewingGuides } from '../../src/nodes/types.ts';
import { fx } from '../lib/orders.ts';

const guides = JSON.parse(readFileSync('data/brewing-guides.json', 'utf8')) as BrewingGuides;
const order = (n: string) => normalize(fx(n));
const variants = (n: string) => selectStock({ order: order('two-methods'), response: JSON.parse(readFileSync(`tests/fixtures/stock/${n}.json`, 'utf8')), threshold: 5 }).variants;
const email = run({ order: order('two-methods'), variants: variants('two-methods'), guides });

it('sends one guide per brew method in order of first appearance', () => {
  expect(email).toMatchObject({ send: true, to: 'pedro.diaz@example.com', subject: 'How to brew your Nubandina coffee', methods: ['pour-over', 'espresso'] });
  expect(email.html.indexOf('<h2>Pour-over</h2>')).toBeLessThan(email.html.indexOf('<h2>Espresso</h2>'));
  expect(email.html).toContain(`<p>Ratio: ${guides['pour-over']?.ratio ?? ''}</p>`);
});
it('greets by first name and lists the coffees bought', () => {
  expect(email.html).toContain('<p>Hi Pedro,</p>');
  expect(email.html).toContain('<li>Nariño (250 g), light roast</li>');
  expect(email.html).toContain('<li>Sierra Nevada (250 g), dark roast</li>');
  expect(email.html.indexOf('Nariño (250 g)')).toBeLessThan(email.html.indexOf('Sierra Nevada (250 g)'));
});
it('sends a single guide when items share a method', () => {
  const v = variants('two-methods').map((x) => ({ ...x, brew_method: 'espresso' }));
  expect(run({ order: order('two-methods'), variants: v, guides }).methods).toEqual(['espresso']);
});
it('escapes customer and product text', () => {
  const v = variants('two-methods').map((x) => ({ ...x, product_title: 'Nariño & <i>Co</i>' }));
  const html = run({ order: { ...order('two-methods'), first_name: '<b>Ana</b>' }, variants: v, guides }).html;
  expect(html).toContain('<p>Hi &lt;b&gt;Ana&lt;/b&gt;,</p>');
  expect(html).toContain('Nariño &amp; &lt;i&gt;Co&lt;/i&gt;');
  expect(html).not.toContain('<b>Ana</b>');
});
it('does not send without an email address', () => expect(run({ order: { ...order('two-methods'), email: null }, variants: variants('two-methods'), guides }).send).toBe(false));
it('does not send when no item has a known brew method', () => {
  const v = variants('two-methods').map((x) => ({ ...x, brew_method: 'cold-brew' }));
  expect(run({ order: order('two-methods'), variants: v, guides })).toMatchObject({ send: false, methods: [] });
});
it('falls back to a generic greeting', () =>
  expect(run({ order: { ...order('two-methods'), first_name: null }, variants: variants('two-methods'), guides }).html).toContain('<p>Hi there,</p>'));
