// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { BREW_METHODS, PEOPLE, TASTE_TO_ROAST, TASTES } from '../../src/theme/recommend.ts';
import { renderFinder } from '../lib/theme-render.ts';

/** The values of the form's radio inputs named `name`, in document order. */
const radioValues = async (name: string): Promise<string[]> => {
  const template = document.createElement('template');
  template.innerHTML = await renderFinder();
  return [...template.content.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map((input) => input.value);
};

describe('the finder form and its TypeScript options', () => {
  it('the brew-method radios are exactly BREW_METHODS, in order', async () => {
    expect(await radioValues('brew_method')).toEqual([...BREW_METHODS]);
  });

  it('the taste radios are exactly TASTES and the keys of TASTE_TO_ROAST', async () => {
    const values = await radioValues('taste');
    expect(values).toEqual([...TASTES]);
    expect([...values].sort()).toEqual(Object.keys(TASTE_TO_ROAST).sort());
  });

  it('the people radios are exactly PEOPLE', async () => {
    expect(await radioValues('people')).toEqual(PEOPLE.map(String));
  });

  it('every brew method has a brewing guide and every guide is a brew method', () => {
    const guides = JSON.parse(readFileSync('data/brewing-guides.json', 'utf8')) as Record<string, unknown>;
    expect(Object.keys(guides).sort()).toEqual([...BREW_METHODS].sort());
  });

  it("every product's metafields use the finder's values", () => {
    const rows = parse<Record<string, string>>(readFileSync('data/products.csv', 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
    const methods = rows.map((row) => row['Brew method (product.metafields.coffee.brew_method)']).filter((value): value is string => value !== undefined && value !== '');
    const roasts = rows.map((row) => row['Roast (product.metafields.coffee.roast)']).filter((value): value is string => value !== undefined && value !== '');
    expect(methods.length).toBeGreaterThan(0);
    expect(roasts.length).toBeGreaterThan(0);
    for (const method of methods) expect(BREW_METHODS).toContain(method);
    for (const roast of roasts) expect(Object.values(TASTE_TO_ROAST)).toContain(roast);
  });
});
