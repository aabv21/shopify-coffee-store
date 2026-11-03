import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HORIZON_OTHER_SCHEMA_LOCALES,
  HORIZON_OTHER_STOREFRONT_LOCALES,
  INSERTIONS,
  LOCALE_NAMESPACE,
  readThemeLocale,
} from '../../scripts/lib/theme-insertions.ts';

/** Every leaf of a translation tree, as `[dotted key, value]`. */
function leaves(tree: unknown, prefix = LOCALE_NAMESPACE): [string, unknown][] {
  if (typeof tree !== 'object' || tree === null) return [[prefix, tree]];
  return Object.entries(tree).flatMap(([key, value]) => leaves(value, `${prefix}.${key}`));
}

const storefront = { en: new Map(leaves(readThemeLocale('en.default.json'))), es: new Map(leaves(readThemeLocale('es.json'))) };
const schema = { en: new Map(leaves(readThemeLocale('en.default.schema.json'))), es: new Map(leaves(readThemeLocale('es.schema.json'))) };

// Strings that read the same in both languages.
const SAME_IN_SPANISH = new Set(['nubandina.coffee_finder.brew_espresso']);

describe.each([
  ['storefront', storefront],
  ['editor', schema],
])('%s strings', (_kind, { en, es }) => {
  it('exist in English and Spanish under the same keys, each a non-empty string', () => {
    expect([...es.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, value] of [...en, ...es]) {
      expect(typeof value, key).toBe('string');
      expect(String(value).trim(), key).not.toBe('');
    }
  });
  it('are actually translated, keeping each placeholder', () => {
    for (const [key, english] of en) {
      const spanish = String(es.get(key));
      if (!SAME_IN_SPANISH.has(key)) expect(spanish, key).not.toBe(english);
      const placeholders = (text: string) => [...text.matchAll(/\[\w+\]|\{\{\s*\w+\s*\}\}/g)].map((m) => m[0]).sort();
      expect(placeholders(spanish), key).toEqual(placeholders(String(english)));
    }
  });
});

const liquidFiles = ['theme/sections/coffee-finder.liquid', 'theme/snippets/free-shipping-bar.liquid'];
const liquid = liquidFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

it('names exactly the storefront keys the Liquid uses, no more and no fewer', () => {
  const used = new Set([...liquid.matchAll(/'(nubandina\.[\w.]+)'/g)].map((m) => m[1]));
  expect([...used].sort()).toEqual([...storefront.en.keys()].sort());
});

it('names exactly the editor keys the section schema and theme settings use', () => {
  const settingsGroup = JSON.stringify(INSERTIONS.filter((i) => i.kind === 'append-settings-group'));
  const used = new Set([...`${liquid}\n${settingsGroup}`.matchAll(/"t:(nubandina\.[\w.]+)"/g)].map((m) => m[1]));
  expect([...used].sort()).toEqual([...schema.en.keys()].sort());
});

it('gives the section no English default text, so a blank setting falls back to its translation', () => {
  const source = readFileSync('theme/sections/coffee-finder.liquid', 'utf8');
  const json = /\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/.exec(source)?.[1] ?? '{}';
  const settings = (JSON.parse(json) as { settings: Record<string, unknown>[] }).settings;
  for (const setting of settings.filter((s) => s.type === 'text')) expect(setting, String(setting.id)).not.toHaveProperty('default');
  expect(liquid).not.toMatch(/settings\.\w+ \| escape/);
});

it("adds the namespace to every one of Horizon's locale files, in English outside en and es", () => {
  const added = new Map(INSERTIONS.flatMap((i) => (i.kind === 'add-locale-namespace' ? [[i.file, i.translations] as const] : [])));
  expect(added.get('locales/es.json')).toEqual(readThemeLocale('es.json'));
  expect(added.get('locales/es.schema.json')).toEqual(readThemeLocale('es.schema.json'));
  for (const locale of HORIZON_OTHER_STOREFRONT_LOCALES) expect(added.get(`locales/${locale}.json`), locale).toEqual(readThemeLocale('en.default.json'));
  for (const locale of HORIZON_OTHER_SCHEMA_LOCALES) expect(added.get(`locales/${locale}.schema.json`), locale).toEqual(readThemeLocale('en.default.schema.json'));
  expect(added.size).toBe(4 + HORIZON_OTHER_STOREFRONT_LOCALES.length + HORIZON_OTHER_SCHEMA_LOCALES.length);
});

it('keeps theme-locales/ to the four source files, each holding only the namespace', () => {
  expect(readdirSync('theme-locales').sort()).toEqual(['en.default.json', 'en.default.schema.json', 'es.json', 'es.schema.json']);
  for (const file of readdirSync('theme-locales')) expect(Object.keys(JSON.parse(readFileSync(join('theme-locales', file), 'utf8')) as object), file).toEqual([LOCALE_NAMESPACE]);
});
