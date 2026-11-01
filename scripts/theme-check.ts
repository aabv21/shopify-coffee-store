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
 * Severity 0 (error) is always a release blocker, wherever it is: even an error in Horizon's own
 * unmodified code would mean something changed about how theme-check or its Liquid docs read it.
 * Any offense (any severity) in a file this repo added or modified is also a blocker, since those
 * are files we're responsible for. Everything else is Horizon's own baseline, which theme-check's
 * live-loaded Liquid docs can shift from run to run with no change in this repo.
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

/**
 * Runs theme check against `themeDir`, returning its offenses as `OffenseLike[]` and the absolute
 * directory they were checked against (the same absolute path `classifyOffenses` needs). check()
 * silently finds zero theme files against a relative root instead of erroring, so this always
 * resolves to an absolute path before calling it.
 */
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
