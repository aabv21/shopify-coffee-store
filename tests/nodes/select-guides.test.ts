import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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

describe('in Spanish', () => {
  const es = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides });

  it("writes the subject, greeting, and guides in the customer's language", () => {
    expect(es).toMatchObject({ send: true, to: 'lucia.restrepo@example.com', subject: 'Cómo preparar su café Nubandina', locale: 'es', methods: ['pour-over', 'espresso'] });
    expect(es.html).toContain('<p>Hola, Lucía:</p>');
    expect(es.html).toContain('<p>Gracias por su pedido #T1006. Así puede sacarle el máximo provecho a su café.</p>');
    expect(es.html).toContain(`<h2>${guides['pour-over']?.translations?.es?.name ?? 'missing'}</h2>`);
    expect(es.html).toContain(`<p>Proporción: ${guides['pour-over']?.translations?.es?.ratio ?? 'missing'}</p>`);
    expect(es.html).toContain('<p>Que disfrute su café,<br>Nubandina Coffee</p>');
  });
  it('names each roast the Colombian way', () => {
    expect(es.html).toContain('<li>Nariño (250 g), tostión clara</li>');
    expect(es.html).toContain('<li>Sierra Nevada (250 g), tostión oscura</li>');
    const v = variants('two-methods').map((x) => ({ ...x, roast: 'medium' }));
    expect(run({ order: order('two-methods-es'), variants: v, guides }).html).toContain('tostión media');
    const unknown = variants('two-methods').map((x) => ({ ...x, roast: 'city+' }));
    expect(run({ order: order('two-methods-es'), variants: unknown, guides }).html).toContain('tostión city+');
  });
  it('leaves no English template text behind', () => {
    for (const english of ['Hi ', 'Thanks', 'Ratio', ' roast', 'Enjoy', 'How to brew']) expect(es.html + es.subject).not.toContain(english);
  });
  it('greets without a name when there is none', () =>
    expect(run({ order: { ...order('two-methods-es'), first_name: null }, variants: variants('two-methods'), guides }).html).toContain('<p>Hola:</p>'));
  it("falls back to a guide's English text when it has no Spanish translation", () => {
    const englishOnly: BrewingGuides = { 'pour-over': { name: 'Pour-over', ratio: '1:16', steps: ['a', 'b', 'c'] } };
    const html = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides: englishOnly }).html;
    expect(html).toContain('<h2>Pour-over</h2>');
    expect(html).toContain('<p>Proporción: 1:16</p>');
  });
});

describe('the configured default locale', () => {
  const withoutLocale = () => {
    const o: Record<string, unknown> = { ...order('two-methods') };
    delete o.locale;
    return o as unknown as ReturnType<typeof order>;
  };

  it("applies when the order's locale is unknown", () => {
    const o = { ...order('two-methods'), locale: null };
    expect(run({ order: o, variants: variants('two-methods'), guides, default_locale: 'es' }).locale).toBe('es');
    expect(run({ order: o, variants: variants('two-methods'), guides, default_locale: 'en' }).locale).toBe('en');
  });
  it('applies to an order normalized before the locale field existed', () =>
    expect(run({ order: withoutLocale(), variants: variants('two-methods'), guides, default_locale: 'es' }).subject).toBe('Cómo preparar su café Nubandina'));
  it('is English when the config predates it too, or holds anything else', () => {
    expect(run({ order: withoutLocale(), variants: variants('two-methods'), guides }).subject).toBe('How to brew your Nubandina coffee');
    expect(run({ order: withoutLocale(), variants: variants('two-methods'), guides, default_locale: '' }).locale).toBe('en');
  });
  it("never overrides the customer's own locale", () =>
    expect(run({ order: order('two-methods'), variants: variants('two-methods'), guides, default_locale: 'es' }).locale).toBe('en'));
});
