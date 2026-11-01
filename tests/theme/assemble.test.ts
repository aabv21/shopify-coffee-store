import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assembleTheme } from '../../scripts/assemble-theme.ts';
import { applyInsertion, InsertionError } from '../../scripts/lib/theme-insertions.ts';
import { buildThemeAsset } from '../../scripts/build-theme.ts';

const base = () => { const d = mkdtempSync(join(tmpdir(), 'nbc-theme-')); cpSync('tests/fixtures/theme-base', d, { recursive: true }); return d; };
const read = (d: string, f: string) => readFileSync(join(d, f), 'utf8');
const render = { kind: 'before-line', file: 'snippets/cart-summary.liquid', anchor: '<div class="cart-totals">', content: "{% render 'free-shipping-bar' %}" } as const;

it('inserts a line before the anchor', () => {
  const d = base(); applyInsertion(d, render);
  expect(read(d, 'snippets/cart-summary.liquid')).toContain("{% render 'free-shipping-bar' %}\n<div class=\"cart-totals\">");
});
it('fails loudly when an anchor is missing or repeated', () => {
  const d = base();
  expect(() => applyInsertion(d, { ...render, anchor: '<div class="gone">' })).toThrow(InsertionError);
  expect(() => applyInsertion(d, { ...render, anchor: '<div' })).toThrow(/anchor appears/);
});
it('appends a settings group once', () => {
  const d = base(); const ins = { kind: 'append-settings-group', file: 'config/settings_schema.json', group: { name: 'Free shipping bar', settings: [] } } as const;
  applyInsertion(d, ins);
  expect((JSON.parse(read(d, 'config/settings_schema.json')) as { name: string }[]).map((g) => g.name)).toEqual(['theme_info', 'Free shipping bar']);
  expect(() => applyInsertion(d, ins)).toThrow(/settings group exists/);
});
it('adds a section after the hero and keeps the leading comment', () => {
  const d = base();
  applyInsertion(d, { kind: 'add-section-after', file: 'templates/index.json', after: 'hero_jVaWmY', key: 'coffee_finder', section: { type: 'coffee-finder', settings: {} } });
  const text = read(d, 'templates/index.json');
  expect(text.startsWith('/* fixture */')).toBe(true);
  expect((JSON.parse(text.slice(text.indexOf('{'))) as { order: string[] }).order).toEqual(['hero_jVaWmY', 'coffee_finder', 'product_list_fa6P9H']);
});
it('builds a self-contained asset with the generated banner', async () => {
  const js = await buildThemeAsset({ source: 'tests/fixtures/theme/hello.ts', asset: 'hello.js' });
  expect(js.split('\n')[0]).toBe('// Generated from tests/fixtures/theme/hello.ts by npm run build:theme; edit the source.');
  expect(js).not.toMatch(/^\s*(import|export)\s/m);
});
it('overlays new files, keeps the overlay README out of the output, and classifies added vs modified', async () => {
  const overlay = mkdtempSync(join(tmpdir(), 'nbc-overlay-'));
  writeFileSync(join(overlay, 'README.md'), 'not a theme file');
  mkdirSync(join(overlay, 'sections'), { recursive: true });
  writeFileSync(join(overlay, 'sections', 'coffee-finder.liquid'), '<div>finder</div>');

  const outDir = join(mkdtempSync(join(tmpdir(), 'nbc-out-')), 'theme');
  const { added, modified } = await assembleTheme({ baseDir: base(), overlayDir: overlay, outDir, insertions: [render] });

  expect(existsSync(join(outDir, 'README.md'))).toBe(false);
  expect(added).toEqual(['sections/coffee-finder.liquid']);
  expect(modified).toEqual(['snippets/cart-summary.liquid']);
});
