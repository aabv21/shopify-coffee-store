import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ASSETS_DIR = 'theme/assets';

// Task 12 adds its own theme entry here.
export const THEME_ENTRIES: readonly { source: string; asset: string }[] = [{ source: 'src/theme/free-shipping-bar.ts', asset: 'free-shipping-bar.js' }];

/**
 * Bundles `entry.source` for the storefront. Not minified: Shopify serves theme assets minified
 * at request time, so shipping already-minified code would double-minify it for no benefit and
 * make the committed source harder to read in the theme editor's code view.
 */
export async function buildThemeAsset(entry: { source: string; asset: string }): Promise<string> {
  const banner = `// Generated from ${entry.source} by npm run build:theme; edit the source.`;
  const result = await build({
    entryPoints: [entry.source],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: false,
    write: false,
    banner: { js: banner },
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced no output for ${entry.source}`);
  return output.text;
}

function readAsset(path: string): string | undefined {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is ASSETS_DIR + a manifest entry's own asset name, not user input
  if (!existsSync(path)) return undefined;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is ASSETS_DIR + a manifest entry's own asset name, not user input
  return readFileSync(path, 'utf8');
}

function writeAsset(path: string, content: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is ASSETS_DIR + a manifest entry's own asset name, not user input
  mkdirSync(dirname(path), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is ASSETS_DIR + a manifest entry's own asset name, not user input
  writeFileSync(path, content);
}

export async function buildTheme(o: { check: boolean; entries: readonly { source: string; asset: string }[] }): Promise<{ drifted: string[] }> {
  const drifted: string[] = [];
  for (const entry of o.entries) {
    const path = join(ASSETS_DIR, entry.asset);
    const current = readAsset(path);
    const next = await buildThemeAsset(entry);
    if (current === next) continue;

    drifted.push(entry.asset);
    if (!o.check) writeAsset(path, next);
  }
  return { drifted };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const { drifted } = await buildTheme({ check, entries: THEME_ENTRIES });
  for (const asset of drifted) console.log(`${check ? 'drift' : 'wrote'} ${asset}`);
  if (check && drifted.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
