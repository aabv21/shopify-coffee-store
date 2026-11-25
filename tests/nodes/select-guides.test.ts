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
  expect(email.html.indexOf('<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">Pour-over</h2>')).toBeLessThan(email.html.indexOf('<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">Espresso</h2>'));
  expect(email.html).toContain(`<p style="margin:0 0 16px">Ratio: ${guides['pour-over']?.ratio ?? ''}</p>`);
});
it('greets by first name and lists the coffees bought', () => {
  expect(email.html).toContain('<p style="margin:0 0 16px">Hi Pedro,</p>');
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
  expect(html).toContain('<p style="margin:0 0 16px">Hi &lt;b&gt;Ana&lt;/b&gt;,</p>');
  expect(html).toContain('Nariño &amp; &lt;i&gt;Co&lt;/i&gt;');
  expect(html).not.toContain('<b>Ana</b>');
});
it('does not send without an email address', () => expect(run({ order: { ...order('two-methods'), email: null }, variants: variants('two-methods'), guides }).send).toBe(false));
it('does not send when no item has a known brew method', () => {
  const v = variants('two-methods').map((x) => ({ ...x, brew_method: 'cold-brew' }));
  expect(run({ order: order('two-methods'), variants: v, guides })).toMatchObject({ send: false, methods: [] });
});
it("a brew method named after an Object.prototype member gets no guide and doesn't throw", () => {
  for (const method of ['constructor', 'toString', '__proto__']) {
    const v = variants('two-methods').map((x) => ({ ...x, brew_method: method }));
    const result = run({ order: order('two-methods'), variants: v, guides: { espresso: guides.espresso } as BrewingGuides });
    expect(result.methods).toEqual([]);
    expect(result.send).toBe(false);
  }
});
it('falls back to a generic greeting', () =>
  expect(run({ order: { ...order('two-methods'), first_name: null }, variants: variants('two-methods'), guides }).html).toContain('<p style="margin:0 0 16px">Hi there,</p>'));

describe('the branded shell', () => {
  it("links back to the store in the customer's language", () => {
    const en = run({ order: order('two-methods'), variants: variants('two-methods'), guides, store: 'nubandina-demo' });
    expect(en.html).toContain('href="https://nubandina-demo.myshopify.com/"');
    expect(en.html).toContain('Shop again');
    const es = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides, store: 'nubandina-demo' });
    expect(es.html).toContain('href="https://nubandina-demo.myshopify.com/es"');
    expect(es.html).toContain('Volver a la tienda');
    expect(es.html).toContain('Recibe este correo porque hizo un pedido en Nubandina Coffee.');
  });
  it('sends the guide without a button when the store is missing or blank', () => {
    for (const extra of [{}, { store: '' }, { store: 'bad.host/x' }]) {
      const html = run({ order: order('two-methods'), variants: variants('two-methods'), guides, ...extra }).html;
      expect(html).not.toContain('<a ');
      expect(html).toContain('You&#39;re getting this email because you ordered from Nubandina Coffee.');
    }
  });
  it('keeps every escaped value inside the shell', () => {
    const html = run({ order: { ...order('two-methods'), first_name: '<b>Ana</b>' }, variants: variants('two-methods'), guides }).html;
    expect(html).toContain('<p style="margin:0 0 16px">Hi &lt;b&gt;Ana&lt;/b&gt;,</p>');
    expect(html).not.toContain('<b>Ana</b>');
  });
});

describe('email layout', () => {
  it('ends the sign-off with a period, in both languages', () => {
    expect(email.html).toContain('Enjoy your coffee.</p>');
    expect(run({ order: order('two-methods-es'), variants: variants('two-methods'), guides }).html).toContain('Que disfrute su café.</p>');
  });
  it('sets the body tags margins inline, because email clients ignore stylesheets', () => {
    expect(email.html).toContain('<ul style="margin:0 0 16px;padding-left:24px">');
    expect(email.html).toContain('<ol style="margin:0 0 16px;padding-left:24px">');
    expect(email.html).not.toMatch(/<(p|ul|ol)>/);
  });
  it('sets the guide headings smaller than the brand header', () => {
    const brand = Number(/font-size:(\d+)px;font-weight:bold">Nubandina Coffee/.exec(email.html)?.[1]);
    const heading = Number(/<h2 style="[^"]*font-size:(\d+)px/.exec(email.html)?.[1]);
    expect(heading).toBeLessThan(brand);
  });
  it("starts with a hidden preheader naming the order, in the customer's language", () => {
    expect(email.html).toMatch(/<body[^>]*><div style="display:none[^"]*">Your brewing guide for order #T1004<\/div>/);
    const es = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides }).html;
    expect(es).toContain('>Su guía de preparación del pedido #T1006</div>');
  });
});

describe('in Spanish', () => {
  const es = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides });

  it("writes the subject, greeting, and guides in the customer's language", () => {
    expect(es).toMatchObject({ send: true, to: 'lucia.restrepo@example.com', subject: 'Cómo preparar su café Nubandina', locale: 'es', methods: ['pour-over', 'espresso'] });
    expect(es.html).toContain('<p style="margin:0 0 16px">Hola, Lucía:</p>');
    expect(es.html).toContain('<p style="margin:0 0 16px">Gracias por su pedido #T1006. Así puede sacarle el máximo provecho a su café.</p>');
    expect(es.html).toContain(`<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">${guides['pour-over']?.translations?.es?.name ?? 'missing'}</h2>`);
    expect(es.html).toContain(`<p style="margin:0 0 16px">Proporción: ${guides['pour-over']?.translations?.es?.ratio ?? 'missing'}</p>`);
    expect(es.html).toContain('<p style="margin:0 0 16px">Que disfrute su café.</p>');
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
    expect(run({ order: { ...order('two-methods-es'), first_name: null }, variants: variants('two-methods'), guides }).html).toContain('<p style="margin:0 0 16px">Hola:</p>'));
  it("falls back to a guide's English text when it has no Spanish translation", () => {
    const englishOnly: BrewingGuides = { 'pour-over': { name: 'Pour-over', ratio: '1:16', steps: ['a', 'b', 'c'] } };
    const html = run({ order: order('two-methods-es'), variants: variants('two-methods'), guides: englishOnly }).html;
    expect(html).toContain('<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">Pour-over</h2>');
    expect(html).toContain('<p style="margin:0 0 16px">Proporción: 1:16</p>');
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
