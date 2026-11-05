import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '@shopify/theme-check-node';
import { assembleTheme } from './assemble-theme.ts';
import { ensureHorizon } from './lib/horizon.ts';
import { INSERTIONS } from './lib/theme-insertions.ts';

const CACHE_ROOT = '.theme-build';
const OUT_DIR = '.theme-build/theme';
const OVERLAY_DIR = 'theme';

export interface OffenseLike { severity: 0 | 1 | 2; check: string; message: string; uri: string }

/**
 * An error anywhere fails, since even one in unmodified Horizon means something changed. So does
 * any offense in a file this repo added or modified. The rest is Horizon's baseline, which
 * theme-check's live-loaded Liquid docs can shift with no change here.
 */
export function classifyOffenses(
  offenses: readonly OffenseLike[],
  themeDir: string,
  ours: { added: readonly string[]; modified: readonly string[] },
): { failing: OffenseLike[]; baseline: OffenseLike[] } {
  const ourFiles = new Set([...ours.added, ...ours.modified]);
  const failing: OffenseLike[] = [];
  const baseline: OffenseLike[] = [];

  for (const offense of offenses) {
    const path = relative(themeDir, fileURLToPath(offense.uri));
    if (offense.severity === 0 || ourFiles.has(path)) failing.push(offense);
    else baseline.push(offense);
  }

  return { failing, baseline };
}

/** check() silently finds no files under a relative root, so this resolves it first. */
export async function runThemeCheck(themeDir: string): Promise<{ absThemeDir: string; offenses: OffenseLike[] }> {
  const absThemeDir = resolve(themeDir);
  const offenses = await check(absThemeDir);
  return { absThemeDir, offenses };
}

async function main(): Promise<void> {
  const horizonDir = await ensureHorizon(CACHE_ROOT);
  const { added, modified } = await assembleTheme({ baseDir: horizonDir, overlayDir: OVERLAY_DIR, outDir: OUT_DIR, insertions: INSERTIONS });

  const { absThemeDir, offenses } = await runThemeCheck(OUT_DIR);
  const { failing, baseline } = classifyOffenses(offenses, absThemeDir, { added, modified });

  console.log(`added: ${added.length.toString()}, modified: ${modified.length.toString()}`);
  for (const offense of failing) {
    console.log(`${offense.severity === 0 ? 'error' : 'warning'} ${offense.check} ${offense.uri}: ${offense.message}`);
  }
  console.log(`failing: ${failing.length.toString()}`);
  console.log(`baseline: ${baseline.length.toString()} (Horizon's own warnings; can drift with theme-check's live-loaded Liquid docs)`);

  if (failing.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
