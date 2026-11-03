import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };

// Reads pnpm's effective config, not just pnpm-workspace.yaml's text, so a misspelled key or a
// value pnpm ignores fails this test instead of passing silently.
const pnpmConfig = async (): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync('pnpm', ['config', 'list', '--json']);
  return JSON.parse(stdout) as Record<string, unknown>;
};

test('pnpm effective config carries every supply-chain setting', async () => {
  const config = await pnpmConfig();
  expect(config.minimumReleaseAge).toBeGreaterThanOrEqual(4320);
  // pnpm 11 ships a built-in exclusion for n8n/n8n-*/@n8n/*; this repo overrides it with an
  // explicit empty list, so nothing is exempt from the release-age gate.
  expect(config.minimumReleaseAgeExclude).toEqual([]);
  expect(config.trustPolicy).toBe('no-downgrade');
  expect(config.blockExoticSubdeps).toBe(true);
  expect(config.strictDepBuilds).toBe(true);
  expect(config.engineStrict).toBe(true);
  expect(config.dangerouslyAllowAllBuilds).toBe(false);
});

test('packageManager pins an exact pnpm 11.x version', () => {
  expect(pkg.packageManager).toMatch(/^pnpm@11\.\d+\.\d+$/);
});

test('package-lock.json does not exist', () => {
  expect(existsSync('package-lock.json')).toBe(false);
});

test('no tracked file still teaches npm or npx commands', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files']);
  const files = stdout.split('\n').filter(Boolean);
  const pattern = /\bnpm (ci|run|test|install|audit)\b|command npm|\bnpx\b/;
  const offenders: string[] = [];
  for (const file of files) {
    if (file === 'tests/supply-chain.test.ts') continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable file; not a text hit
    }
    if (pattern.test(content)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test('every Compose image is pinned by digest', () => {
  for (const file of ['compose.yaml', 'compose.queue.yaml']) {
    const content = readFileSync(file, 'utf8');
    const images = [...content.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
  }
});

test('every docker run image in a GitHub Actions workflow is pinned by digest', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files', '.github/workflows/*.yml', '.github/workflows/*.yaml']);
  const files = stdout.split('\n').filter(Boolean);
  expect(files.length).toBeGreaterThan(0);
  const images: string[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter((l) => /\bdocker run\b/.test(l))) {
      // An image reference is `name:tag`, where `name` may carry `/`s (e.g. `owner/repo`) but never
      // a `/` right at the start (that would be an absolute path, such as a bind-mount argument).
      // This also catches an image with no `/` at all (e.g. `composer:2.11.0`), which an
      // `indexOf('/')`-based parser would silently skip.
      images.push(/\s([a-z0-9][\w./-]*:\S+)/.exec(line)?.[1] ?? `unparsed: ${line.trim()}`);
    }
  }
  // At least one workflow must actually use `docker run`, or this test would pass vacuously.
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/);
});

// Reads the merged, effective Compose config (not the raw YAML text) so `n8n-worker`'s own
// settings, inherited from `n8n` through `extends` in compose.queue.yaml, are checked too, and
// `--profile tunnel` so the profile-gated `ngrok` service is included.
const composeConfig = async (args: string[]): Promise<Record<string, { security_opt?: string[]; cap_drop?: string[] }>> => {
  const { stdout } = await execFileAsync('docker', ['compose', ...args, 'config', '--format', 'json']);
  return (JSON.parse(stdout) as { services: Record<string, { security_opt?: string[]; cap_drop?: string[] }> }).services;
};

test('every long-running service disables privilege escalation', async () => {
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  const tunnel = await composeConfig(['-f', 'compose.yaml', '--profile', 'tunnel']);
  for (const name of ['postgres', 'n8n', 'redis', 'n8n-worker']) {
    expect(queue[name]?.security_opt, name).toContain('no-new-privileges:true');
  }
  expect(tunnel.ngrok?.security_opt).toContain('no-new-privileges:true');
});

test('only n8n (and the worker that extends it) drops every Linux capability', async () => {
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  const tunnel = await composeConfig(['-f', 'compose.yaml', '--profile', 'tunnel']);
  expect(queue.n8n?.cap_drop).toEqual(['ALL']);
  expect(queue['n8n-worker']?.cap_drop).toEqual(['ALL']);
  for (const name of ['postgres', 'redis']) {
    expect(queue[name]?.cap_drop, name).toBeUndefined();
  }
  expect(tunnel.ngrok?.cap_drop).toBeUndefined();
});
