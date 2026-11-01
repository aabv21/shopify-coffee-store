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
])('rejects %j', (patch, message) => expect(() => validateConfig({ ...example, ...patch })).toThrow(message));
