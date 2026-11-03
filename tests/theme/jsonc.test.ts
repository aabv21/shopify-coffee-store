import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseJsonc, stripJsonComments } from '../../scripts/lib/jsonc.ts';

it('drops line and block comments outside strings', () =>
  expect(parseJsonc('/* header\n * more */\n{\n  // a note\n  "a": 1, /* inline */ "b": [2]\n}\n')).toEqual({ a: 1, b: [2] }));

it('keeps comment-like text and escaped quotes inside strings', () =>
  expect(parseJsonc('{ "url": "https://example.com/a//b", "glob": "/* not a comment */", "quote": "say \\"hi\\" // still text" }')).toEqual({
    url: 'https://example.com/a//b',
    glob: '/* not a comment */',
    quote: 'say "hi" // still text',
  }));

it('keeps line numbers and offsets stable by blanking comments instead of removing them', () => {
  const source = '{\n  // note\n  "a": 1\n}';
  expect(stripJsonComments(source)).toHaveLength(source.length);
  expect(stripJsonComments(source).split('\n')).toHaveLength(4);
});

it('fails on an unterminated block comment or invalid JSON', () => {
  expect(() => parseJsonc('{ /* open')).toThrow(/unterminated comment/);
  expect(() => parseJsonc('{ "a": }')).toThrow();
});

// Every locale file in the downloaded Horizon, when a previous theme command cached it.
const horizonLocales = (() => {
  const cache = '.theme-build';
  if (!existsSync(cache)) return [];
  const horizon = readdirSync(cache).find((d) => d.startsWith('horizon-') && !d.endsWith('.tar.gz'));
  return horizon ? readdirSync(join(cache, horizon, 'locales')).map((f) => join(cache, horizon, 'locales', f)) : [];
})();
// Skipped until the Horizon cache exists (CI runs tests before assembly); `theme:check` parses every file in CI.
it.skipIf(horizonLocales.length === 0)("parses every one of Horizon's own locale files", () => {
  for (const file of horizonLocales) expect(typeof parseJsonc(readFileSync(file, 'utf8')), file).toBe('object');
});
