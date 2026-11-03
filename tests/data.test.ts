import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { expect, it } from 'vitest';

const rows = parse<Record<string, string>>(readFileSync('data/products.csv'), { columns: true, bom: true });
interface GuideText { name: string; ratio: string; steps: string[] }
const guides = JSON.parse(readFileSync('data/brewing-guides.json', 'utf8')) as Record<string, GuideText & { translations?: Record<string, GuideText> }>;
const ROAST = 'Roast (product.metafields.coffee.roast)';
const NOTES = 'Tasting notes (product.metafields.coffee.tasting_notes)';
const METHOD = 'Brew method (product.metafields.coffee.brew_method)';

it('has three origins in two sizes with the planned prices and stock', () =>
  expect(rows.map((r) => [r['URL handle'], r['Option1 value'], r['SKU'], r['Price'], r['Inventory quantity'], r['Weight value (grams)']])).toEqual([
    ['narino', '250 g', 'NBC-NAR-250', '46000', '40', '250'], ['narino', '500 g', 'NBC-NAR-500', '84000', '40', '500'],
    ['huila', '250 g', 'NBC-HUI-250', '44000', '40', '250'], ['huila', '500 g', 'NBC-HUI-500', '76000', '40', '500'],
    ['sierra-nevada', '250 g', 'NBC-SNV-250', '38000', '40', '250'], ['sierra-nevada', '500 g', 'NBC-SNV-500', '68000', '6', '500'],
  ]));
it('puts the metafields on the first row of each product only', () => {
  expect(rows.filter((r) => r['Title'] !== '').map((r) => [r['Title'], r[ROAST], r[METHOD], r[NOTES]])).toEqual([
    ['Nariño', 'light', 'pour-over', 'Orange blossom, red apple, panela'],
    ['Huila', 'medium', 'french-press', 'Caramel, red berries, cocoa'],
    ['Sierra Nevada', 'dark', 'espresso', 'Dark chocolate, roasted almond, molasses'],
  ]);
  for (const r of rows.filter((x) => x['Title'] === '')) expect([r[ROAST], r[METHOD], r[NOTES]]).toEqual(['', '', '']);
});
it('gives each product a public https image with alt text', () => {
  for (const r of rows.filter((x) => x['Title'] !== '')) {
    expect(r['Product image URL']).toMatch(/^https:\/\//);
    expect(r['Image alt text']?.length).toBeGreaterThan(0);
  }
});
it('has one guide per brew method with a ratio and three short steps', () => {
  expect(Object.keys(guides).sort()).toEqual(['espresso', 'french-press', 'pour-over']);
  expect([guides['pour-over']?.ratio, guides['espresso']?.ratio, guides['french-press']?.ratio].map((r) => r?.split(' ')[0])).toEqual(['1:16', '1:2', '1:15']);
  for (const g of Object.values(guides)) {
    expect(g.steps).toHaveLength(3);
    for (const s of g.steps) expect(s.length).toBeLessThanOrEqual(140);
  }
});
it('translates every guide into Spanish, field for field, with the same ratio', () => {
  for (const [method, g] of Object.entries(guides)) {
    expect(Object.keys(g.translations ?? {}), method).toEqual(['es']);
    const es = g.translations?.es;
    expect(es?.name.trim(), method).not.toBe('');
    expect(es?.ratio.split(' ')[0], method).toBe(g.ratio.split(' ')[0]);
    expect(es?.steps, method).toHaveLength(3);
    for (const s of es?.steps ?? []) {
      expect(s.trim(), method).not.toBe('');
      expect(s.length, method).toBeLessThanOrEqual(140);
    }
  }
});
