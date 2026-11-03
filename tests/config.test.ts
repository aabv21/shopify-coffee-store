import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CREDENTIALS } from '../scripts/lib/manifest.ts';

it('config example has every runtime key', () => {
  expect(JSON.parse(readFileSync('config/config.example.json', 'utf8'))).toEqual({
    owner_email: 'owner@example.com',
    google: { orders_sheet_id: 'REPLACE_ME', orders_tab: 'Orders' },
    shopify: { store: 'replace-me', api_version: '2026-10' },
    low_stock_threshold: 5,
    guide_delay_minutes: 60,
    default_locale: 'en',
    team_locale: 'en',
  });
});

/** Every `.ts` file directly or recursively under `dir`. */
function tsFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...tsFilesUnder(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

it('.env.example lists every variable compose and the scripts read', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');
  const declared = new Set([...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));

  const usedByCompose = [...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]);

  const usedByCredentials = CREDENTIALS.flatMap((c) => c.env);

  const usedByScripts = tsFilesUnder('scripts').flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  });

  const used = [...usedByCompose, ...usedByCredentials, ...usedByScripts];
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});
