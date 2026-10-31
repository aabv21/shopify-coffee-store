import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('config example has every runtime key', () => {
  expect(JSON.parse(readFileSync('config/config.example.json', 'utf8'))).toEqual({
    owner_email: 'owner@example.com',
    google: { orders_sheet_id: 'REPLACE_ME', orders_tab: 'Orders' },
    shopify: { store: 'replace-me', api_version: '2026-10' },
    low_stock_threshold: 5,
    guide_delay_minutes: 60,
  });
});

it('.env.example lists every variable compose and the scripts read', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');
  const used = [...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]);
  const declared = new Set([...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});
