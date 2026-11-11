import { expect, it } from 'vitest';
import { assertSameStore, checkConfigFile } from '../../scripts/check-config.ts';

it('returns the validated config', () => expect(checkConfigFile('config/config.example.json').shopify.store).toBe('replace-me'));
it('a blank SHOPIFY_STORE skips the store check', () => {
  expect(() => { assertSameStore('nubandina-dev', undefined); }).not.toThrow();
  expect(() => { assertSameStore('nubandina-dev', ''); }).not.toThrow();
});
it('a SHOPIFY_STORE that differs from config.shopify.store stops setup naming both', () =>
  expect(() => { assertSameStore('nubandina-dev', 'other-store'); }).toThrow(
    'SHOPIFY_STORE in .env ("other-store") and shopify.store in config/config.json ("nubandina-dev") must name the same store',
  ));
it('matching stores pass', () => expect(() => { assertSameStore('nubandina-dev', 'nubandina-dev'); }).not.toThrow());
