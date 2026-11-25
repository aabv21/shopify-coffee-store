import { describe, expect, it } from 'vitest';
import { BRAND_PALETTE } from '../../scripts/lib/theme-insertions.data.ts';
import { brandedEmail, EMAIL_COLORS, storeUrl } from '../../src/nodes/email-shell.ts';

const base = { lang: 'en', title: 'T', bodyHtml: '<p>Body</p>', cta: { label: 'Go', url: 'https://x.myshopify.com/' }, footer: 'Foot' } as const;

describe('brandedEmail', () => {
  it('wraps the body in the brand header and footer, in the given language', () => {
    const html = brandedEmail({ ...base, lang: 'es' });
    expect(html).toMatch(/^<!doctype html><html lang="es">/);
    expect(html).toContain('<title>T</title>');
    expect(html).toContain('max-width:560px');
    expect(html).toContain('Nubandina Coffee');
    expect(html).toContain('<p>Body</p>');
    expect(html.indexOf('Nubandina Coffee')).toBeLessThan(html.indexOf('<p>Body</p>'));
    expect(html.indexOf('<p>Body</p>')).toBeLessThan(html.indexOf('Foot'));
  });
  it('escapes the title, the CTA label and URL, and the footer', () => {
    const evil = '<b>&"';
    const html = brandedEmail({ ...base, title: evil, cta: { label: evil, url: evil }, footer: evil });
    expect(html).not.toContain('<b>');
    expect(html.split('&lt;b&gt;&amp;&quot;').length - 1).toBe(4);
  });
  it('omits the button when cta is null', () => expect(brandedEmail({ ...base, cta: null })).not.toContain('<a '));
});

it('escapes the preheader and hides it', () => {
  const html = brandedEmail({ ...base, preheader: '<i>&' });
  expect(html).toContain('&lt;i&gt;&amp;</div>');
  expect(html).toContain('display:none');
  expect(brandedEmail(base)).not.toContain('display:none');
});

it('storeUrl adds /es for Spanish and refuses a value that is not a store subdomain', () => {
  expect(storeUrl('nubandina-demo', 'es')).toBe('https://nubandina-demo.myshopify.com/es');
  expect(storeUrl('nubandina-demo', 'en')).toBe('https://nubandina-demo.myshopify.com/');
  expect(storeUrl('evil.com/x', 'en')).toBeNull();
  expect(storeUrl('', 'en')).toBeNull();
});

it("the email colors are the theme's brand colors", () => {
  expect(EMAIL_COLORS).toEqual({ background: BRAND_PALETTE.background, text: BRAND_PALETTE.foreground, accent: BRAND_PALETTE.color1, muted: BRAND_PALETTE.color3 });
});
