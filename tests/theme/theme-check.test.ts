import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { classifyOffenses, runThemeCheck } from '../../scripts/theme-check.ts';

const o = (severity: 0 | 1 | 2, file: string) => ({ severity, check: 'X', message: 'm', uri: `file:///t/${file}` });
it('fails on errors anywhere and on any offense in our files', () => {
  const { failing, baseline } = classifyOffenses(
    [o(0, 'sections/header.liquid'), o(1, 'snippets/divider.liquid'), o(1, 'sections/coffee-finder.liquid'), o(2, 'snippets/cart-summary.liquid')],
    '/t', { added: ['sections/coffee-finder.liquid'], modified: ['snippets/cart-summary.liquid'] });
  expect(failing.map((x) => x.uri.split('/t/')[1])).toEqual(['sections/header.liquid', 'sections/coffee-finder.liquid', 'snippets/cart-summary.liquid']);
  expect(baseline).toHaveLength(1);
});

// check() builds its file:// root without resolving it, so a short relative path like the CLI's own
// `.theme-build/theme` matched zero files. A path relative to the OS temp dir starts with "../" and
// happens to resolve anyway, so this fixture lives under `.theme-build/` to reproduce the real shape.
it('finds a real syntax error even when given a relative theme directory', async () => {
  mkdirSync('.theme-build', { recursive: true });
  const dir = mkdtempSync(join('.theme-build', 'nbc-theme-check-'));
  cpSync('tests/fixtures/theme-base', dir, { recursive: true });
  writeFileSync(join(dir, 'snippets/broken.liquid'), '{% if %}');

  try {
    const { offenses } = await runThemeCheck(dir);
    expect(offenses.some((offense) => offense.uri.endsWith('snippets/broken.liquid'))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
