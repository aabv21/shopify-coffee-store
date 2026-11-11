import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig, type Config } from '../src/lib/config.ts';

export function checkConfigFile(path: string): Config {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a CLI argument the operator passes on purpose, not user input
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return validateConfig(raw);
}

/**
 * The stock read authenticates with `.env`'s store and builds its URL from the config's, so a
 * mismatch would fail only at the first real order. A blank `SHOPIFY_STORE` (offline, CI) passes.
 */
export function assertSameStore(configStore: string, envStore: string | undefined): void {
  if (!envStore || envStore === configStore) return;
  throw new Error(`SHOPIFY_STORE in .env ("${envStore}") and shopify.store in config/config.json ("${configStore}") must name the same store`);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/check-config.ts <path>');
    process.exitCode = 1;
    return;
  }
  try {
    checkConfigFile(path);
    console.log('config OK');
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
