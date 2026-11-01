import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/lib/config.ts';

export function checkConfigFile(path: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a CLI argument the operator passes on purpose, not user input
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  validateConfig(raw);
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
