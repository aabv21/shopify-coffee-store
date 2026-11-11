// Compares Lighthouse's mobile scores for an unpublished Horizon base theme and the Nubandina
// theme on the same password-protected dev store, as medians over alternating runs.
// NOTE: Lighthouse sends the storefront cookie as an extra `Cookie` header on every request, to
// every origin the page loads, and that header replaces the cookies Chrome would send itself. Both
// themes are measured the same way, so the comparison holds; a per-domain cookie would need a
// Puppeteer-driven Lighthouse.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/compose.ts';

// Run through `pnpm dlx` rather than installed: it's needed only at the live session, and its
// dependency tree would otherwise join every install and every `pnpm audit`.
// NOTE: 13.3.0 is the newest release whose tree passes `trustPolicy: no-downgrade`: 13.4.0 and
// later need puppeteer-core 25, whose chromium-bidi release lost its trusted publisher. Move up
// once a later release installs with `pnpm dlx lighthouse@<version> --version`. Only this version
// is pinned: `pnpm dlx` resolves its dependencies fresh on each run, under this repo's
// `minimumReleaseAge` and `trustPolicy`.
export const LIGHTHOUSE_VERSION = '13.3.0';
/**
 * The tolerance chosen for Performance, not a measured property of Lighthouse: mobile scores can
 * move by more than this between runs. On a near miss, re-run with `--runs 9`.
 */
export const PERFORMANCE_MARGIN = 2;

const THEME_ID_RE = /^\d+$/;
const STORE_RE = /^[a-z0-9][a-z0-9-]*$/;
const PATH_RE = /^\/[^?#\s]*$/;
const REPORTS_DIR = '.lighthouse';
/** All `pnpm dlx` and Chrome need from the environment; `.env`'s secrets never reach them. */
const CHILD_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CHROME_PATH', 'PNPM_HOME',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot',
] as const;

export interface LighthouseArgs { baseTheme: string; theme: string; runs: number; path: string }
export interface Scores { performance: number; accessibility: number }
export interface Comparison { base: Scores; theme: Scores; passes: boolean }

function flagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

export function parseLighthouseArgs(argv: readonly string[]): LighthouseArgs {
  let baseTheme: string | undefined;
  let theme: string | undefined;
  let runs = 5;
  let path = '/';
  for (let i = 0; i < argv.length; i += 1) {
    // eslint-disable-next-line security/detect-object-injection -- i walks argv's own indices, not user-controlled keys
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--base-theme') baseTheme = flagValue(argv, i++, arg);
    else if (arg === '--theme') theme = flagValue(argv, i++, arg);
    else if (arg === '--runs') runs = Number(flagValue(argv, i++, arg));
    else if (arg === '--path') path = flagValue(argv, i++, arg);
    else throw new Error(`unknown argument: ${String(arg)}`);
  }
  if (baseTheme === undefined) throw new Error('--base-theme <id> is required (the unpublished Horizon theme)');
  if (theme === undefined) throw new Error('--theme <id> is required (the unpublished Nubandina theme)');
  if (!THEME_ID_RE.test(baseTheme)) throw new Error('--base-theme must be a numeric theme id');
  if (!THEME_ID_RE.test(theme)) throw new Error('--theme must be a numeric theme id');
  if (!Number.isInteger(runs) || runs < 1 || runs % 2 === 0) throw new Error('--runs must be an odd whole number, so the median is a real run');
  if (!PATH_RE.test(path)) throw new Error('--path must start with / and hold no query or fragment');
  return { baseTheme, theme, runs, path };
}

function storeHost(store: string): string {
  if (!STORE_RE.test(store)) throw new Error('SHOPIFY_STORE must be the store subdomain only, such as nubandina-dev');
  return `https://${store}.myshopify.com`;
}

export function previewUrl(store: string, themeId: string, path: string): string {
  return `${storeHost(store)}${path}?preview_theme_id=${themeId}`;
}

/** `pnpm`'s arguments for one run, on Lighthouse's default mobile config. */
export function lighthouseArgs(o: { url: string; outputPath: string; headersPath: string }): string[] {
  return [
    'dlx',
    `lighthouse@${LIGHTHOUSE_VERSION}`,
    o.url,
    '--only-categories=performance,accessibility',
    '--output=json',
    `--output-path=${o.outputPath}`,
    `--extra-headers=${o.headersPath}`,
    '--chrome-flags=--headless=new',
    '--quiet',
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Each category's score as a whole number; a failed run has a null score, which is never a 0. */
export function readScores(report: unknown): Scores {
  const lhr = isRecord(report) ? report : {};
  const categories = isRecord(lhr.categories) ? lhr.categories : {};
  const toScore = (category: unknown): number => {
    const score = isRecord(category) ? category.score : undefined;
    if (typeof score === 'number') return Math.round(score * 100);
    const code = isRecord(lhr.runtimeError) && typeof lhr.runtimeError.code === 'string' ? lhr.runtimeError.code : undefined;
    throw new Error(`Lighthouse run failed: ${code ?? 'no score'}`);
  };
  return { performance: toScore(categories.performance), accessibility: toScore(categories.accessibility) };
}

export interface MeasuredPage { store: string; themeId: string; path: string }

/** Fails unless Lighthouse ended on the requested theme preview, not the password page or the published theme. */
export function assertMeasuredPage(report: unknown, expected: MeasuredPage): void {
  const lhr = isRecord(report) ? report : {};
  const finalUrl = typeof lhr.finalDisplayedUrl === 'string' ? lhr.finalDisplayedUrl : lhr.mainDocumentUrl;
  if (typeof finalUrl !== 'string') throw new Error('Lighthouse report has no final URL');
  const url = new URL(finalUrl);
  const fail = (why: string) => new Error(`Lighthouse ended on ${finalUrl}: ${why}`);
  if (url.host !== `${expected.store}.myshopify.com`) throw fail(`expected ${expected.store}.myshopify.com`);
  if (url.pathname === '/password') throw fail('the storefront password page; check SHOPIFY_STOREFRONT_PASSWORD');
  if (url.pathname !== expected.path) throw fail(`expected the path ${expected.path}`);
  if (url.searchParams.get('preview_theme_id') !== expected.themeId) {
    throw fail(`expected preview_theme_id=${expected.themeId}; is the theme ID right and the theme unpublished?`);
  }
}

/** A saved report keeps its settings but never the storefront cookie Lighthouse records with them. */
export function redactReport(report: unknown): unknown {
  if (!isRecord(report) || !isRecord(report.configSettings) || report.configSettings.extraHeaders == null) return report;
  return { ...report, configSettings: { ...report.configSettings, extraHeaders: '[redacted]' } };
}

export function median(values: readonly number[]): number {
  if (values.length === 0 || values.length % 2 === 0) throw new Error(`median needs an odd number of values, got ${String(values.length)}`);
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) / 2] ?? Number.NaN;
}

export function compareThemes(base: readonly Scores[], theme: readonly Scores[]): Comparison {
  const medians = (runs: readonly Scores[]): Scores => ({
    performance: median(runs.map((s) => s.performance)),
    accessibility: median(runs.map((s) => s.accessibility)),
  });
  const b = medians(base);
  const t = medians(theme);
  return { base: b, theme: t, passes: t.performance >= b.performance - PERFORMANCE_MARGIN && t.accessibility >= b.accessibility };
}

/** A row for README's "Theme performance" table. */
export function resultsRow(date: string, result: Comparison): string {
  const cells = [date, result.base.performance, result.theme.performance, result.base.accessibility, result.theme.accessibility, result.passes ? 'yes' : 'no'];
  return `| ${cells.map(String).join(' | ')} |`;
}

/** Unlocks the password-protected dev store and returns its `storefront_digest=<value>` cookie pair. */
export async function storefrontDigest(store: string, password: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${storeHost(store)}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ form_type: 'storefront_password', utf8: '✓', password }).toString(),
    redirect: 'manual',
  });
  const digest = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]?.trim() ?? '').find((pair) => pair.startsWith('storefront_digest='));
  if (!digest) throw new Error(`storefront password rejected (HTTP ${String(response.status)})`);
  return digest;
}

export function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    // eslint-disable-next-line security/detect-object-injection -- key comes from the fixed CHILD_ENV_KEYS list
    const value = env[key];
    // eslint-disable-next-line security/detect-object-injection -- the same fixed key
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/**
 * Runs Lighthouse once and reads its report. Lighthouse saves the report before it exits 1 on a
 * runtime error, so the cookie is removed whatever the exit code, and that error's code is shown.
 */
export async function measureOnce(o: { run: () => Promise<void>; outputPath: string; expected: MeasuredPage }): Promise<Scores> {
  let runError: Error | undefined;
  try {
    await o.run();
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a report path built from fixed names and the date
  if (!existsSync(o.outputPath)) throw runError ?? new Error(`Lighthouse wrote no report at ${o.outputPath}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the same report path
  const report = redactReport(JSON.parse(readFileSync(o.outputPath, 'utf8')));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the same report, rewritten without the cookie
  writeFileSync(o.outputPath, JSON.stringify(report));
  const scores = readScores(report);
  if (runError !== undefined) throw runError;
  assertMeasuredPage(report, o.expected);
  return scores;
}

/** The process events `withSecretsDir` listens to; `process` itself in production. */
export interface SignalTarget {
  readonly pid: number;
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  kill(pid: number, signal: 'SIGINT' | 'SIGTERM'): unknown;
}

/** A private temp directory for the cookie file, removed on return, on error, and on Ctrl+C or SIGTERM. */
export async function withSecretsDir<T>(fn: (dir: string) => Promise<T>, proc: SignalTarget = process): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'nubandina-lighthouse-'));
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); };
  const onSigint = () => { cleanup(); proc.kill(proc.pid, 'SIGINT'); };
  const onSigterm = () => { cleanup(); proc.kill(proc.pid, 'SIGTERM'); };
  proc.once('SIGINT', onSigint);
  proc.once('SIGTERM', onSigterm);
  try {
    return await fn(dir);
  } finally {
    proc.removeListener('SIGINT', onSigint);
    proc.removeListener('SIGTERM', onSigterm);
    cleanup();
  }
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: childEnv(process.env) });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0] ?? ''} ${args[1] ?? ''} exited with code ${String(code)}`));
    });
  });
}

async function main(): Promise<void> {
  const args = parseLighthouseArgs(process.argv.slice(2));
  loadDotEnv();
  const store = process.env.SHOPIFY_STORE;
  const password = process.env.SHOPIFY_STOREFRONT_PASSWORD;
  if (!store || !password) throw new Error('SHOPIFY_STORE and SHOPIFY_STOREFRONT_PASSWORD must both be set in .env');

  const digest = await storefrontDigest(store, password);
  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = join(REPORTS_DIR, date);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directory plus the date
  mkdirSync(reportsDir, { recursive: true });
  await withSecretsDir(async (secretsDir) => {
    const headersPath = join(secretsDir, 'headers.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside our own mkdtemp directory
    writeFileSync(headersPath, JSON.stringify({ Cookie: digest }), { mode: 0o600 });
    const base: Scores[] = [];
    const theme: Scores[] = [];
    const sides = [{ label: 'base', themeId: args.baseTheme, scores: base }, { label: 'theme', themeId: args.theme, scores: theme }];
    for (let n = 1; n <= args.runs; n += 1) {
      for (const side of sides) {
        const outputPath = join(reportsDir, `${side.label}-${String(n)}.json`);
        const url = previewUrl(store, side.themeId, args.path);
        const scores = await measureOnce({
          run: () => run('pnpm', lighthouseArgs({ url, outputPath, headersPath })),
          outputPath,
          expected: { store, themeId: side.themeId, path: args.path },
        });
        side.scores.push(scores);
        console.log(`${side.label} run ${String(n)}: performance ${String(scores.performance)}, accessibility ${String(scores.accessibility)}`);
      }
    }
    const result = compareThemes(base, theme);
    console.log(`median Horizon: performance ${String(result.base.performance)}, accessibility ${String(result.base.accessibility)}`);
    console.log(`median Nubandina: performance ${String(result.theme.performance)}, accessibility ${String(result.theme.accessibility)}`);
    console.log(resultsRow(date, result));
    if (!result.passes) {
      console.error(`Nubandina is more than ${String(PERFORMANCE_MARGIN)} points below Horizon on Performance, or below it on Accessibility`);
      process.exitCode = 1;
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
