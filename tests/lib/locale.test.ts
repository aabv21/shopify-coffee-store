import { expect, it } from 'vitest';
import { isLocale, LOCALES, normalizeLocale } from '../../src/lib/locale.ts';

it('supports exactly English and Spanish', () => expect(LOCALES).toEqual(['en', 'es']));

it.each([
  ['es', 'es'],
  ['es-CO', 'es'],
  ['es_CO', 'es'],
  ['ES-mx', 'es'],
  [' es-419 ', 'es'],
  ['en', 'en'],
  ['en-US', 'en'],
  ['en_CA', 'en'],
  ['EN', 'en'],
])('normalizes %j to %j', (input, expected) => expect(normalizeLocale(input, 'en')).toBe(expected));

it.each([[undefined], [null], [''], ['fr'], ['fr-CA'], ['pt-BR'], ['spanish'], ['e'], ['-es'], [42], [{ locale: 'es' }]])(
  'falls back for %j',
  (input) => {
    expect(normalizeLocale(input, 'es')).toBe('es');
    expect(normalizeLocale(input, 'en')).toBe('en');
    expect(normalizeLocale(input, null)).toBeNull();
  },
);

it('recognizes only an exact supported locale', () => {
  expect([isLocale('en'), isLocale('es')]).toEqual([true, true]);
  expect([isLocale('es-CO'), isLocale('EN'), isLocale(undefined)]).toEqual([false, false, false]);
});
