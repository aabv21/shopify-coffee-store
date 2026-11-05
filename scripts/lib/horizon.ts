import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HORIZON = { version: '4.3.0', commit: 'dfad90d87be2408de52636315069fc998da28c9e' } as const;

export async function ensureHorizon(cacheRoot: string): Promise<string> {
  const dir = join(cacheRoot, `horizon-${HORIZON.commit}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is cacheRoot + the fixed pinned commit, not user input
  if (existsSync(dir)) return dir;

  const url = `https://codeload.github.com/Shopify/horizon/tar.gz/${HORIZON.commit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to download Horizon: ${response.status.toString()} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- cacheRoot is the caller's own fixed build directory, not user input
  mkdirSync(cacheRoot, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is cacheRoot + the fixed pinned commit, not user input
  mkdirSync(dir, { recursive: true });
  const archive = join(cacheRoot, `horizon-${HORIZON.commit}.tar.gz`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- archive is cacheRoot + the fixed pinned commit, not user input
  writeFileSync(archive, bytes);

  try {
    await execFileAsync('tar', ['-xzf', archive, '-C', dir, '--strip-components=1']);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    rmSync(archive, { force: true });
  }

  return dir;
}
