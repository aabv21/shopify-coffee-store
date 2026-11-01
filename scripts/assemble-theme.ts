import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureHorizon } from './lib/horizon.ts';
import { applyInsertion, INSERTIONS, type Insertion } from './lib/theme-insertions.ts';

const CACHE_ROOT = '.theme-build';
const OUT_DIR = '.theme-build/theme';
const OVERLAY_DIR = 'theme';

// The overlay's own documentation, at its root; never shipped as a theme asset.
const OVERLAY_README = 'README.md';

/** Every file (not directory) recursively under `dir`, as paths relative to `dir`. */
function filesUnder(dir: string): string[] {
  const files: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is a caller-chosen overlay root, not user input
  if (!existsSync(dir)) return files;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is a caller-chosen overlay root, not user input
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

// Assembly itself is synchronous (fs and the insertion applier have no async step); this stays
// Promise-returning to match ensureHorizon and buildThemeAsset, the other theme-toolchain steps a
// caller awaits in sequence.
export function assembleTheme(o: {
  baseDir: string;
  overlayDir: string;
  outDir: string;
  insertions: readonly Insertion[];
}): Promise<{ added: string[]; modified: string[] }> {
  rmSync(o.outDir, { recursive: true, force: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- o.outDir is the caller's own fixed build directory, not user input
  mkdirSync(dirname(o.outDir), { recursive: true });
  cpSync(o.baseDir, o.outDir, { recursive: true });

  const added: string[] = [];
  const modified = new Set<string>();

  for (const source of filesUnder(o.overlayDir)) {
    const relPath = relative(o.overlayDir, source);
    if (relPath === OVERLAY_README) continue;

    const dest = join(o.outDir, relPath);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dest is outDir + the overlay file's own relative path, not user input
    const existedInBase = existsSync(dest);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dest is outDir + the overlay file's own relative path, not user input
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(source, dest);

    if (existedInBase) modified.add(relPath);
    else added.push(relPath);
  }

  for (const insertion of o.insertions) {
    applyInsertion(o.outDir, insertion);
    modified.add(insertion.file);
  }

  return Promise.resolve({ added, modified: [...modified] });
}

async function main(): Promise<void> {
  const horizonDir = await ensureHorizon(CACHE_ROOT);
  const { added, modified } = await assembleTheme({ baseDir: horizonDir, overlayDir: OVERLAY_DIR, outDir: OUT_DIR, insertions: INSERTIONS });
  console.log(`added: ${added.length.toString()}`);
  for (const file of added) console.log(`  + ${file}`);
  console.log(`modified: ${modified.length.toString()}`);
  for (const file of modified) console.log(`  ~ ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
