import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assembleTheme } from '../../scripts/assemble-theme.ts';
import { applyInsertion, InsertionError } from '../../scripts/lib/theme-insertions.ts';
import { buildThemeAsset } from '../../scripts/build-theme.ts';
import { parseJsonc } from '../../scripts/lib/jsonc.ts';

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
  expect(js.split('\n')[0]).toBe('// Generated from tests/fixtures/theme/hello.ts by pnpm run build:theme; edit the source.');
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

const strings = { coffee_finder: { heading: 'Find your coffee', note: 'Say "hi" // not a comment' } };
const addStrings = (file: string) => ({ kind: 'add-locale-namespace', file, namespace: 'nubandina', translations: strings }) as const;

it('adds a namespace to a locale file, keeping its leading comment and translator notes', () => {
  const d = base();
  applyInsertion(d, addStrings('locales/en.default.json'));
  const text = read(d, 'locales/en.default.json');
  expect(text.startsWith('/*\n * fixture\n */\n{')).toBe(true);
  expect(text).toContain('// A note for translators, like Horizon\'s own.');
  const parsed = parseJsonc(text) as Record<string, unknown>;
  expect(Object.keys(parsed)).toEqual(['nubandina', 'actions']);
  expect(parsed.nubandina).toEqual(strings);
  expect(parsed.actions).toEqual({ add: 'Add', nubandina: "a nested key with the namespace's name" });
});
it('adds a namespace to a locale file with no comment and to an empty one', () => {
  const d = base();
  applyInsertion(d, addStrings('locales/es.json'));
  expect(parseJsonc(read(d, 'locales/es.json'))).toEqual({ nubandina: strings, actions: { add: 'Agregar' } });
  writeFileSync(join(d, 'locales/fr.json'), '{}\n');
  applyInsertion(d, addStrings('locales/fr.json'));
  expect(parseJsonc(read(d, 'locales/fr.json'))).toEqual({ nubandina: strings });
});
it('fails loudly when the namespace already exists at the top level', () => {
  const d = base();
  applyInsertion(d, addStrings('locales/es.json'));
  expect(() => applyInsertion(d, addStrings('locales/es.json'))).toThrow(/locales\/es\.json: namespace exists: nubandina/);
});
it('fails loudly when the locale file is missing or is not a JSON object', () => {
  const d = base();
  expect(() => applyInsertion(d, addStrings('locales/xx.json'))).toThrow(InsertionError);
  expect(() => applyInsertion(d, addStrings('locales/xx.json'))).toThrow(/locales\/xx\.json: file not found/);
  writeFileSync(join(d, 'locales/list.json'), '["a"]');
  expect(() => applyInsertion(d, addStrings('locales/list.json'))).toThrow(/locales\/list\.json: not a JSON object/);
});
