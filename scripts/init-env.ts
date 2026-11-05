import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EXAMPLE_PATH = '.env.example';
const ENV_PATH = '.env';
const N8N_IMPORT_DIR = '.n8n-import';

// Only what the local stack and the dev harness need. Third-party values (ngrok, Shopify, Google)
// stay blank, so a workflow needing a real credential never looks configured when it isn't.
const GENERATED_NAMES = new Set([
  'POSTGRES_PASSWORD',
  'N8N_DB_PASSWORD',
  'APP_DB_PASSWORD',
  'APP_RUNTIME_DB_PASSWORD',
  'N8N_ENCRYPTION_KEY',
  'DEV_HARNESS_TOKEN',
]);

function defaultRandomHex(): string {
  return randomBytes(32).toString('hex');
}

export function fillSecrets(example: string, randomHex: () => string = defaultRandomHex): string {
  return example
    .split('\n')
    .map((line) => {
      const match = /^([A-Z0-9_]+)=$/.exec(line);
      if (!match) return line;
      const name = match[1];
      if (name === undefined || !GENERATED_NAMES.has(name)) return line;
      return `${name}=${randomHex()}`;
    })
    .join('\n');
}

/**
 * Atomic, at mode 0600: a truncated `.env` would lose `N8N_ENCRYPTION_KEY` and with it every n8n
 * credential. The explicit chmod covers a stale tmp file, since `{ mode }` applies only on create.
 */
export function writeEnvFile(path: string, text: string): void {
  const tmpPath = `${path}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  writeFileSync(tmpPath, text, { mode: 0o600 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  chmodSync(tmpPath, 0o600);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  renameSync(tmpPath, path);
}

/**
 * Creates the bind-mounted directory at 0700 before anything else touches it. It serves only
 * `pnpm run export`; credentials never cross it. On Linux, n8n (uid 1000) can write into a 0700
 * directory only when the host uid matches.
 */
export function ensureN8nImportDir(path: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .n8n-import path, not user input
  if (existsSync(path)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .n8n-import path, not user input
  mkdirSync(path, { mode: 0o700 });
}

function main(): void {
  if (existsSync(ENV_PATH)) {
    console.error('.env already exists; delete it to regenerate.');
    process.exitCode = 1;
    return;
  }
  const example = readFileSync(EXAMPLE_PATH, 'utf8');
  writeEnvFile(ENV_PATH, fillSecrets(example));
  ensureN8nImportDir(N8N_IMPORT_DIR);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
