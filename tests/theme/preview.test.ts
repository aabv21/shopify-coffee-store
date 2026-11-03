import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSERTIONS } from '../../scripts/lib/theme-insertions.ts';
import {
  createPreviewEngine,
  hoverShift,
  parseCatalog,
  parseFontHandle,
  parseHex,
  presetFontSizes,
  previewFontsUrl,
  previewScope,
  resolveSettings,
  sectionSettingDefaults,
  shiftLightness,
  staticRootVariables,
  themeCssVariables,
  toHex,
} from '../../scripts/lib/theme-preview.ts';
import { previewPage } from '../../scripts/theme-preview.ts';
import { parseProducts, readAnswers, recommend } from '../../src/theme/recommend.ts';

const MONEY = '${{amount_no_decimals_with_comma_separator}}';
const catalog = () => parseCatalog(readFileSync('data/products.csv', 'utf8'));
const section = readFileSync('theme/sections/coffee-finder.liquid', 'utf8');
const snippet = readFileSync('theme/snippets/free-shipping-bar.liquid', 'utf8');

// The free-shipping settings exactly as the insertion adds them to settings_schema.json.
const freeShippingGroup = INSERTIONS.flatMap((i) => (i.kind === 'append-settings-group' ? [i.group] : []));
const barSettings = resolveSettings(freeShippingGroup, { current: {} });

describe('mock catalog', () => {
  it('shapes one product per handle from data/products.csv, with every variant, in cents', () => {
    const products = catalog();
    expect(products.map((p) => [p.id, p.handle, p.title, p.url])).toEqual([
      [1001, 'narino', 'Nariño', '/products/narino'],
      [1002, 'huila', 'Huila', '/products/huila'],
      [1003, 'sierra-nevada', 'Sierra Nevada', '/products/sierra-nevada'],
    ]);
    expect(products[0]?.variants).toEqual([
      { id: 2001, title: '250 g', weight: 250, available: true, price: 4_600_000 },
      { id: 2002, title: '500 g', weight: 500, available: true, price: 8_400_000 },
    ]);
    expect(products[2]?.metafields.coffee).toEqual({ roast: { value: 'dark' }, tasting_notes: { value: 'Dark chocolate, roasted almond, molasses' }, brew_method: { value: 'espresso' } });
    expect(products[1]?.featured_image).toEqual({ src: expect.stringMatching(/^https:\/\/burst\.shopifycdn\.com\//) as unknown, alt: 'Close-up overhead view of whole roasted coffee beans filling the frame' });
  });

  const header = 'Title,URL handle,Status,Option1 value,Price,Inventory quantity,Continue selling when out of stock,Weight value (grams),Product image URL,Image alt text,Roast (product.metafields.coffee.roast),Tasting notes (product.metafields.coffee.tasting_notes),Brew method (product.metafields.coffee.brew_method)';
  it('marks a variant sold out only when it has no stock and stops selling', () => {
    const csv = `${header}\nA,a,Active,250 g,10,0,DENY,250,,,light,,pour-over\n,a,,500 g,20,0,CONTINUE,500,,,,,`;
    const [product] = parseCatalog(csv);
    expect(product?.variants.map((v) => v.available)).toEqual([false, true]);
    expect(product?.featured_image).toBeNull();
    expect(product?.metafields.coffee.tasting_notes).toEqual({ value: null });
  });
  it('skips products that are not Active and fails loudly on a malformed row', () => {
    expect(parseCatalog(`${header}\nA,a,Draft,250 g,10,1,DENY,250,,,,,`)).toEqual([]);
    expect(() => parseCatalog(`${header}\n,a,Active,250 g,10,1,DENY,250,,,,,`)).toThrow(/first row has no Title/);
    expect(() => parseCatalog(`${header}\nA,a,Active,250 g,ten,1,DENY,250,,,,,`)).toThrow(/price is not a number/);
  });
});

describe('settings', () => {
  const schema = [
    { name: 'colors', settings: [{ type: 'color_palette', id: 'palette', default: { bg: '#ffffff', ink: '#000000' } }] },
    { name: 'buttons', settings: [{ type: 'color', id: 'button', default: '{{ settings.palette.ink }}' }, { type: 'header', content: 'x' }, { type: 'range', id: 'radius', default: 4 }] },
  ];
  it('overlays current values on the schema defaults and resolves palette references', () => {
    expect(resolveSettings(schema, { current: { radius: 8, palette: { bg: '#fbf7f2', ink: '#2b1b12' } } })).toEqual({
      palette: { bg: '#fbf7f2', ink: '#2b1b12' },
      button: '#2b1b12',
      radius: 8,
    });
  });
  it('reads the named preset when current is a preset name', () =>
    expect(resolveSettings(schema, { current: 'Default', presets: { Default: { radius: 2 } } }).radius).toBe(2));
  it('fails on a reference to a palette key that does not exist', () =>
    expect(() => resolveSettings(schema, { current: { button: '{{ settings.palette.accent }}' } })).toThrow(/palette\.accent/));
  it("reads a section's schema defaults", () => {
    const defaults = sectionSettingDefaults(section);
    expect(defaults.heading).toBe('Find your coffee');
    expect(defaults).not.toHaveProperty('collection');
  });
});

describe('colors and fonts', () => {
  it('lightens and darkens like Shopify, by HSL lightness points', () => {
    // shopify.dev's color_lighten example: '#EA5AB9' | color_lighten: 30 is #fbe2f3.
    expect(toHex(shiftLightness(parseHex('#EA5AB9'), 30))).toBe('#fbe2f3');
    expect(toHex(shiftLightness(parseHex('#fff'), -100))).toBe('#000000');
  });
  it("shifts a hover color the way Horizon's util-palette-hover-shift does", () => {
    expect(toHex(hoverShift(parseHex('#000000')))).toBe('#262626'); // brightness <= 40: lighten 15
    expect(toHex(hoverShift(parseHex('#7C2D12')))).toBe('#923515'); // <= 128: lighten 5
    expect(toHex(hoverShift(parseHex('#ffffff')))).toBe('#f2f2f2'); // > 190: darken 5
  });
  it('rejects a color that is not a hex', () => expect(() => parseHex('rgb(0 0 0)')).toThrow(/#rgb or #rrggbb/));
  it('parses a font handle and refuses a family the preview cannot load', () => {
    expect(parseFontHandle('alegreya_sans_i7')).toEqual({ key: 'alegreya_sans', family: 'Alegreya Sans', fallback: 'sans-serif', weight: 700, style: 'italic' });
    expect(() => parseFontHandle('comic_sans_n4')).toThrow(/not in PREVIEW_FONTS/);
    expect(() => parseFontHandle('alegreya')).toThrow(/not a Shopify font handle/);
  });
  it('asks Google Fonts for each family once, with its own weight and bold', () =>
    expect(previewFontsUrl({ type_body_font: 'alegreya_sans_n4', type_subheading_font: 'alegreya_sans_n5', type_heading_font: 'alegreya_n5', type_accent_font: 'alegreya_n7' }))
      .toBe('https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@400;500;700&family=Alegreya:wght@500;700&display=swap'));
});

describe('CSS variables', () => {
  it("sizes type presets like Horizon: fixed under 48px, clamped from the next size down above it", () => {
    const sizes = presetFontSizes({ type_size_paragraph: '16', type_size_h1: '56', type_size_h2: '48', type_size_h3: '32', type_size_h4: '24', type_size_h5: '14', type_size_h6: '12' });
    expect(sizes).toEqual({
      paragraph: '1rem',
      h1: 'clamp(3rem, 5.6vw, 3.5rem)',
      h2: 'clamp(2.25rem, 4.8vw, 3rem)',
      h3: '2rem',
      h4: '1.5rem',
      h5: '0.875rem',
      h6: '0.75rem',
    });
  });
  it("keeps the Liquid-free lines of Horizon's :root block, nested media queries included", () => {
    const source = `{% style %}\n{%- liquid\n  assign x = 1\n%}\n:root {\n  --gap-md: 0.9rem;\n  --font-size--sm: 0.875rem;\n  --focus-outline-width: 0.1rem;\n  --opacity-10: 0.1;\n  --animation-speed: 0.125s;\n  --radius: {{ settings.r }}px;\n  --stroke: {% if a %}1px{% else %}2px{% endif %};\n  @media (min-width: 750px) {\n    --gap-md: 1rem;\n  }\n}\n.other { color: red; }\n{% endstyle %}`;
    const css = staticRootVariables(source);
    expect(css).toContain('--gap-md: 0.9rem;');
    expect(css).toContain('@media (min-width: 750px)');
    expect(css).not.toMatch(/--radius|--stroke|\.other|\{\{|\{%/);
    expect(() => staticRootVariables(':root {\n  --gap-md: 1rem;\n}')).toThrow(/missing --font-size--sm/);
  });
  it('derives the button, input, and font variables from the settings', () => {
    const css = themeCssVariables({
      color_palette: { background: '#FBF7F2', foreground: '#2B1B12', color1: '#7C2D12' },
      page_background_color: '#FBF7F2', page_text_color: '#2B1B12',
      palette_primary_button_text: '#FBF7F2', palette_primary_button_background: '#7C2D12', palette_primary_button_border: '#7C2D12',
      palette_secondary_button_text: '#2B1B12', palette_secondary_button_background: '#FBF7F2', palette_secondary_button_border: '#2B1B12',
      palette_input_background: '#FBF7F2', palette_input_text: '#2B1B12', palette_input_border: '#6B5B4E',
      type_body_font: 'alegreya_sans_n4', type_subheading_font: 'alegreya_sans_n5', type_heading_font: 'alegreya_n5', type_accent_font: 'alegreya_n7',
      type_size_paragraph: '16', type_size_h1: '56', type_size_h2: '48', type_size_h3: '32', type_size_h4: '24', type_size_h5: '14', type_size_h6: '12',
      type_font_h1: 'heading', type_font_h2: 'heading', type_font_h3: 'heading', type_font_h4: 'heading', type_font_h5: 'subheading', type_font_h6: 'subheading',
      type_line_height_paragraph: 'body-loose', type_line_height_h2: 'display-tight', type_letter_spacing_h2: 'heading-normal', type_case_h2: 'none',
      pills_border_radius: 40, inputs_border_radius: 4, button_border_radius_primary: 14, button_border_radius_secondary: 14,
      primary_button_border_width: 0, secondary_button_border_width: 1, input_border_width: 1, popover_border_radius: 14,
      type_font_button_primary: 'body', type_font_button_secondary: 'body', button_text_case_primary: 'default', button_text_case_secondary: 'default',
    });
    for (const line of [
      '--color-background: #fbf7f2;',
      '--color-foreground-rgb: 43 27 18;',
      '--color-primary-button-background: rgb(124 45 18 / 1.0);',
      '--color-primary-button-hover-background: #923515;',
      '--color-primary-button-hover-text: rgb(251 247 242 / 1.0);',
      '--color-input-border: rgb(107 91 78 / 1.0);',
      '--font-heading--family: "Alegreya", serif;',
      '--font-body--weight: 400;',
      '--font-h2--size: var(--font-size--h2);',
      '--font-h2--line-height: var(--line-height--display-tight);',
      '--style-border-radius-inputs: 4px;',
    ]) expect(css).toContain(line);
  });
});

describe('preview engine', () => {
  const render = (source: string, cartTotalCents: number, settings = barSettings) => {
    const preview = createPreviewEngine({ moneyFormat: MONEY, assetUrl: (name) => `assets/${name}` });
    const scope = previewScope({ products: catalog(), sectionSettings: sectionSettingDefaults(section), settings, moneyFormat: MONEY, cartTotalCents });
    return { html: preview.engine.parseAndRenderSync(source, scope) as string, stylesheets: preview.stylesheets() };
  };

  it('stubs money, asset_url, and image_url, and fails on any other Shopify-only filter', () => {
    const { engine } = createPreviewEngine({ moneyFormat: MONEY, assetUrl: (name) => `/a/${name}` });
    expect(engine.parseAndRenderSync("{{ 4600000 | money }} {{ 'x.js' | asset_url }} {{ img | image_url: width: 400 }}", { img: { src: 'https://cdn.example.com/a.jpg?width=1000' } }))
      .toBe('$46.000 /a/x.js https://cdn.example.com/a.jpg?width=400');
    expect(() => { engine.parseAndRenderSync("{{ 'a' | t }}"); }).toThrow(/undefined filter: t/);
  });
  it('drops schema and doc blocks and collects each stylesheet once', () => {
    const preview = createPreviewEngine({ moneyFormat: MONEY, assetUrl: (name) => name });
    const source = '{% doc %} @param {string} x {% enddoc %}a{% schema %}{ "name": "x" }{% endschema %}{% stylesheet %} .a { color: red; } {% endstylesheet %}';
    expect(preview.engine.parseAndRenderSync(source)).toBe('a');
    preview.engine.parseAndRenderSync(source);
    expect(preview.stylesheets()).toEqual(['.a { color: red; }']);
  });
  it('renders the real free-shipping bar with its server-side progress, message, and state', () => {
    const { html, stylesheets } = render(snippet, 7_200_000);
    expect(html).toContain('data-state="remaining"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('aria-valuetext="You’re $48.000 away from free shipping"');
    expect(html).toContain('--free-shipping-progress: 0.6;');
    expect(stylesheets.join('')).toContain('.free-shipping-bar__fill');

    const reached = render(snippet, 12_000_000).html;
    expect(reached).toContain('data-state="reached"');
    expect(reached).toContain('aria-valuenow="100"');
    expect(reached).toContain('You’ve got free shipping!');
  });
  it('hides the bar when the threshold is zero', () =>
    expect(render(snippet, 100, { ...barSettings, free_shipping_threshold: 0 }).html).not.toContain('<free-shipping-bar'));
  it("renders the real coffee finder with product JSON the finder's own parser and recommender accept", () => {
    const { html } = render(section, 0);
    const json = /<script type="application\/json" data-finder-products>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    const products = parseProducts(JSON.parse(json));
    expect(products.map((p) => p.title)).toEqual(['Nariño', 'Huila', 'Sierra Nevada']);
    expect(products[0]?.variants[0]?.price).toBe('$46.000');
    expect(products[0]?.image?.src).toMatch(/width=400$/);
    const answers = readAnswers([['brew_method', 'pour-over'], ['taste', 'mild'], ['people', '1']]);
    expect(recommend(products, answers!).map((r) => [r.product.title, r.variant.title])).toEqual([['Nariño', '250 g']]);
    expect(html).toContain('data-message="Choose an answer for each question."');
  });
});

describe('preview page', () => {
  it('labels itself as an approximation and loads Horizon CSS, the brand fonts, and both components', () => {
    const fontsUrl = previewFontsUrl({ type_body_font: 'inter_n4', type_subheading_font: 'inter_n5', type_heading_font: 'inter_n7', type_accent_font: 'inter_n7' });
    const page = previewPage({
      fontsUrl,
      pageWidth: 'narrow',
      staticVariables: ':root {}',
      themeVariables: ':root { --color-background: #fbf7f2; }',
      componentCss: [],
      finderHtml: '<coffee-finder></coffee-finder>',
      bars: [{ percent: 60, totalCents: 7_200_000, html: '<free-shipping-bar></free-shipping-bar>' }],
    });
    expect(page).toContain('<title>Nubandina theme preview (approximation)</title>');
    expect(page).toContain('Offline preview: an approximation');
    expect(page).toContain('href="assets/base.css"');
    expect(page).toContain('<body class="page-width-narrow">');
    expect(page).toContain('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&amp;display=swap');
    expect(page).toContain('data-preview-demo="cart-60"');
    expect(page).toContain('$72.000');
  });
});
