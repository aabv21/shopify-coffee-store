import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateConfig } from '../../src/lib/config.ts';

const example = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as Record<string, unknown>;
it('accepts the example', () => expect(validateConfig(example)).toEqual(example));
it.each([
  [{ owner_email: 'nope' }, 'owner_email must be an email address'],
  [{ shopify: { store: 'x.myshopify.com', api_version: '2026-10' } }, 'shopify.store must be the store subdomain'],
  [{ shopify: { store: 'nubandina-demo', api_version: '2026-11' } }, 'shopify.api_version must look like 2026-10'],
  [{ low_stock_threshold: 0 }, 'low_stock_threshold must be an integer >= 1'],
  [{ guide_delay_minutes: 1 }, 'guide_delay_minutes must be an integer >= 2'],
  [{ default_locale: 'fr' }, 'default_locale must be "en" or "es"'],
  [{ default_locale: 'es-CO' }, 'default_locale must be "en" or "es"'],
  [{ team_locale: '' }, 'team_locale must be "en" or "es"'],
  [{ team_locale: null }, 'team_locale must be "en" or "es"'],
])('rejects %j', (patch, message) => expect(() => validateConfig({ ...example, ...patch })).toThrow(message));

it('accepts Spanish for either locale', () =>
  expect(validateConfig({ ...example, default_locale: 'es', team_locale: 'es' })).toMatchObject({ default_locale: 'es', team_locale: 'es' }));

it('defaults a config written before the locale keys existed to English', () => {
  const legacy: Record<string, unknown> = { ...example };
  delete legacy.default_locale;
  delete legacy.team_locale;
  expect(validateConfig(legacy)).toEqual({ ...legacy, default_locale: 'en', team_locale: 'en' });
  expect(legacy).not.toHaveProperty('team_locale');
});
