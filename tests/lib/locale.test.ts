import { expect, it } from 'vitest';
import { isLocale, LOCALES, messagesFor, normalizeLocale, STORE_TIMEZONE } from '../../src/lib/locale.ts';

it('the store time zone is Bogota', () => expect(STORE_TIMEZONE).toBe('America/Bogota'));

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

it('messagesFor picks the table entry by tag and falls back', () => {
  const table = { en: 'E', es: 'S' };
  expect(messagesFor(table, 'es-CO')).toBe('S');
  expect(messagesFor(table, 'fr')).toBe('E');
  expect(messagesFor(table, 'fr', 'es')).toBe('S');
  expect(messagesFor(table, undefined)).toBe('E');
});
