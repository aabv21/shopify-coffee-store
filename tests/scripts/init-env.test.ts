import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ensureN8nImportDir, fillSecrets, writeEnvFile } from '../../scripts/init-env.ts';

const execFileAsync = promisify(execFile);

const example = ['# Postgres', 'POSTGRES_USER=postgres', 'POSTGRES_PASSWORD=', 'N8N_DB_PASSWORD=', 'APP_DB_PASSWORD=',
  'APP_RUNTIME_DB_USER=app_runtime', 'APP_RUNTIME_DB_PASSWORD=', 'N8N_ENCRYPTION_KEY=', 'N8N_URL=http://localhost:5678', 'NGROK_AUTHTOKEN=', 'NGROK_DOMAIN=',
  'SHOPIFY_STORE=', 'SHOPIFY_CLIENT_ID=', 'SHOPIFY_CLIENT_SECRET=', 'SHOPIFY_ACCESS_TOKEN=',
  'GOOGLE_OAUTH_CLIENT_ID=', 'GOOGLE_OAUTH_CLIENT_SECRET=', 'DEV_HARNESS_TOKEN=', ''].join('\n');

describe('fillSecrets', () => {
  it('fills only the stack/dev-harness names, keeps every other blank and preset value as-is', () => {
    let n = 0;
    const next = (): string => `hex${String(++n)}`;
    expect(fillSecrets(example, next)).toBe(['# Postgres', 'POSTGRES_USER=postgres', 'POSTGRES_PASSWORD=hex1', 'N8N_DB_PASSWORD=hex2',
      'APP_DB_PASSWORD=hex3', 'APP_RUNTIME_DB_USER=app_runtime', 'APP_RUNTIME_DB_PASSWORD=hex4', 'N8N_ENCRYPTION_KEY=hex5', 'N8N_URL=http://localhost:5678', 'NGROK_AUTHTOKEN=', 'NGROK_DOMAIN=',
      'SHOPIFY_STORE=', 'SHOPIFY_CLIENT_ID=', 'SHOPIFY_CLIENT_SECRET=', 'SHOPIFY_ACCESS_TOKEN=',
      'GOOGLE_OAUTH_CLIENT_ID=', 'GOOGLE_OAUTH_CLIENT_SECRET=', 'DEV_HARNESS_TOKEN=hex6', ''].join('\n'));
  });
});

describe('.env.tmp', () => {
  it('is git-ignored, so a crashed writeEnvFile run never leaves secrets in a tracked file', async () => {
    await expect(execFileAsync('git', ['check-ignore', '-q', '.env.tmp'])).resolves.toBeDefined();
  });
});

describe('writeEnvFile', () => {
  it('writes .env atomically at mode 0600, even over a stale, looser-mode temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbc-env-'));
    try {
      const path = join(dir, '.env');
      // A crashed prior run can leave `.env.tmp` behind at whatever mode it was created with.
      // `writeFileSync`'s `{ mode }` option only applies when the file doesn't already exist, so
      // without the defensive chmod this stale file would keep its looser mode.
      writeFileSync(`${path}.tmp`, 'stale', { mode: 0o644 });
      writeEnvFile(path, 'A=1\nN8N_ENCRYPTION_KEY=secret\n');
      expect(readFileSync(path, 'utf8')).toBe('A=1\nN8N_ENCRYPTION_KEY=secret\n');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('ensureN8nImportDir', () => {
  it('creates the directory at mode 0700 when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbc-import-'));
    try {
      const target = join(dir, '.n8n-import');
      ensureN8nImportDir(target);
      expect(statSync(target).isDirectory()).toBe(true);
      expect(statSync(target).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('leaves an existing directory and its contents alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbc-import-'));
    try {
      const target = join(dir, '.n8n-import');
      mkdirSync(target, { mode: 0o755 });
      writeFileSync(join(target, 'kept.json'), '{}');
      ensureN8nImportDir(target);
      expect(readFileSync(join(target, 'kept.json'), 'utf8')).toBe('{}');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
