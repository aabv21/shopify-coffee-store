import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertMeasuredPage,
  childEnv,
  compareThemes,
  LIGHTHOUSE_VERSION,
  lighthouseArgs,
  measureOnce,
  median,
  parseLighthouseArgs,
  previewUrl,
  readScores,
  redactReport,
  resultsRow,
  storefrontDigest,
  withSecretsDir,
} from '../../scripts/lighthouse.ts';

const scores = (performance: number, accessibility: number) => ({ performance, accessibility });

describe('arguments', () => {
  it('parses theme ids and defaults to 5 runs on /', () => {
    expect(parseLighthouseArgs(['--base-theme', '111', '--theme', '222'])).toEqual({ baseTheme: '111', theme: '222', runs: 5, path: '/' });
    expect(parseLighthouseArgs(['--', '--base-theme', '111', '--theme', '222', '--runs', '3', '--path', '/collections/all']))
      .toEqual({ baseTheme: '111', theme: '222', runs: 3, path: '/collections/all' });
  });

  it('rejects a missing or non-numeric theme id and an even run count', () => {
    expect(() => parseLighthouseArgs(['--theme', '1'])).toThrow(/--base-theme/);
    expect(() => parseLighthouseArgs(['--base-theme', '1'])).toThrow(/--theme/);
    expect(() => parseLighthouseArgs(['--base-theme', 'abc', '--theme', '1'])).toThrow(/--base-theme must be a numeric theme id/);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--runs', '4'])).toThrow(/--runs must be an odd whole number/);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--runs', '0'])).toThrow(/--runs/);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--path', 'collections'])).toThrow(/--path must start with \//);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--path', '/collections?sort=price'])).toThrow(/no query or fragment/);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--path', '/collections#top'])).toThrow(/no query or fragment/);
    expect(() => parseLighthouseArgs(['--base-theme', '1', '--theme', '2', '--bogus'])).toThrow(/unknown argument: --bogus/);
  });

  it('builds the preview URL', () =>
    expect(previewUrl('nubandina-dev', '123', '/')).toBe('https://nubandina-dev.myshopify.com/?preview_theme_id=123'));

  it('rejects a SHOPIFY_STORE that is not a bare subdomain', async () => {
    for (const store of ['evil.com/x', 'a.b', 'nubandina-dev.myshopify.com', '']) {
      expect(() => previewUrl(store, '123', '/')).toThrow(/subdomain only/);
    }
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 302 })));
    await expect(storefrontDigest('evil.com/x', 'hunter2-example', fetchImpl)).rejects.toThrow(/subdomain only/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pins Lighthouse to an exact version and asks only for performance and accessibility', () => {
    expect(LIGHTHOUSE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const args = lighthouseArgs({ url: 'https://example.com/', outputPath: '/tmp/x.json', headersPath: '/tmp/h.json' });
    expect(args.slice(0, 3)).toEqual(['dlx', `lighthouse@${LIGHTHOUSE_VERSION}`, 'https://example.com/']);
    expect(args).toContain('--only-categories=performance,accessibility');
    expect(args).toContain('--output-path=/tmp/x.json');
    expect(args).toContain('--extra-headers=/tmp/h.json');
    expect(args.some((arg) => arg.startsWith('--preset'))).toBe(false);
  });
});

describe('scores', () => {
  it('reads category scores as whole numbers', () =>
    expect(readScores({ categories: { performance: { score: 0.874 }, accessibility: { score: 0.96 } } })).toEqual(scores(87, 96)));

  it("a null category score fails with Lighthouse's runtime error code", () => {
    expect(() => readScores({ categories: { performance: { score: null }, accessibility: { score: 0.9 } }, runtimeError: { code: 'NO_FCP' } })).toThrow(/NO_FCP/);
    expect(() => readScores({ categories: {} })).toThrow('Lighthouse run failed: no score');
  });

  it('takes the median of an odd number of runs', () => {
    expect(median([70, 90, 71, 69, 72])).toBe(71);
    expect(() => median([])).toThrow();
    expect(() => median([1, 2])).toThrow();
  });

  it('passes within 2 points of base on performance and not below it on accessibility', () => {
    const base = [scores(72, 96)];
    expect(compareThemes(base, [scores(70, 96)]).passes).toBe(true);
    expect(compareThemes(base, [scores(75, 97)]).passes).toBe(true);
    expect(compareThemes(base, [scores(69, 96)]).passes).toBe(false);
    expect(compareThemes(base, [scores(72, 95)]).passes).toBe(false);
    expect(compareThemes([scores(70, 95), scores(72, 96), scores(74, 97)], [scores(71, 96), scores(60, 90), scores(73, 98)]))
      .toEqual({ base: scores(72, 96), theme: scores(71, 96), passes: true });
  });

  it('a saved report keeps no storefront cookie', () => {
    const report = { configSettings: { formFactor: 'mobile', extraHeaders: { Cookie: 'storefront_digest=abc' } }, categories: {} };
    expect(JSON.stringify(redactReport(report))).not.toContain('storefront_digest');
    expect(redactReport(report)).toMatchObject({ configSettings: { formFactor: 'mobile' } });
    expect(redactReport({ categories: {} })).toEqual({ categories: {} });
  });

  it('the results row is ready to paste', () =>
    expect(resultsRow('2026-11-12', { base: scores(71, 96), theme: scores(70, 97), passes: true })).toBe('| 2026-11-12 | 71 | 70 | 96 | 97 | yes |'));
});

describe('storefront password', () => {
  const PASSWORD = 'hunter2-example';

  it("storefront digest from the password form's cookie", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 302, headers: { 'set-cookie': 'storefront_digest=abc; path=/; HttpOnly' } })));
    await expect(storefrontDigest('nubandina-dev', PASSWORD, fetchImpl)).resolves.toBe('storefront_digest=abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://nubandina-dev.myshopify.com/password');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(init.body as string).toContain('form_type=storefront_password');
  });

  it('a rejected storefront password throws without echoing it', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('<form>', { status: 200 })));
    const error = await storefrontDigest('nubandina-dev', PASSWORD, fetchImpl).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/HTTP 200/);
    expect((error as Error).message).not.toContain(PASSWORD);
  });
});

describe('a single run', () => {
  const COOKIE = 'storefront_digest=secret-digest';
  const expected = { store: 'nubandina-dev', themeId: '222', path: '/' };
  const page = 'https://nubandina-dev.myshopify.com/?preview_theme_id=222';
  const report = (o: Record<string, unknown> = {}) => ({
    requestedUrl: page,
    mainDocumentUrl: page,
    finalDisplayedUrl: page,
    configSettings: { formFactor: 'mobile', extraHeaders: { Cookie: COOKIE } },
    categories: { performance: { score: 0.71 }, accessibility: { score: 0.96 } },
    ...o,
  });
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const outputPathIn = () => {
    dir = mkdtempSync(join(tmpdir(), 'lighthouse-test-'));
    return join(dir, 'theme-1.json');
  };

  it('a run that writes its report and then exits 1 leaves no cookie on disk and names the runtime error', async () => {
    const outputPath = outputPathIn();
    const run = () => {
      writeFileSync(outputPath, JSON.stringify(report({ categories: { performance: { score: null }, accessibility: { score: null } }, runtimeError: { code: 'NO_FCP' } })));
      return Promise.reject(new Error('pnpm dlx lighthouse@13.3.0 exited with code 1'));
    };
    await expect(measureOnce({ run, outputPath, expected })).rejects.toThrow('Lighthouse run failed: NO_FCP');
    expect(readFileSync(outputPath, 'utf8')).not.toContain('secret-digest');
  });

  it('a successful run is saved without the cookie and scored', async () => {
    const outputPath = outputPathIn();
    const run = () => { writeFileSync(outputPath, JSON.stringify(report())); return Promise.resolve(); };
    await expect(measureOnce({ run, outputPath, expected })).resolves.toEqual(scores(71, 96));
    expect(readFileSync(outputPath, 'utf8')).not.toContain('secret-digest');
  });

  it('a run that fails before writing a report rethrows its own error', async () => {
    const outputPath = outputPathIn();
    await expect(measureOnce({ run: () => Promise.reject(new Error('spawn pnpm ENOENT')), outputPath, expected })).rejects.toThrow('spawn pnpm ENOENT');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('a run that measured the wrong page fails, and its report still loses the cookie', async () => {
    const outputPath = outputPathIn();
    const run = () => { writeFileSync(outputPath, JSON.stringify(report({ finalDisplayedUrl: 'https://nubandina-dev.myshopify.com/password' }))); return Promise.resolve(); };
    await expect(measureOnce({ run, outputPath, expected })).rejects.toThrow(/ended on https:\/\/nubandina-dev\.myshopify\.com\/password/);
    expect(readFileSync(outputPath, 'utf8')).not.toContain('secret-digest');
  });

  it('the storefront password page is never measured', () =>
    expect(() => { assertMeasuredPage(report({ finalDisplayedUrl: 'https://nubandina-dev.myshopify.com/password' }), expected); }).toThrow(/password page/));

  it('a page without the requested theme preview, or on another path, is never measured', () => {
    expect(() => { assertMeasuredPage(report({ finalDisplayedUrl: 'https://nubandina-dev.myshopify.com/' }), expected); }).toThrow(/preview_theme_id=222/);
    expect(() => { assertMeasuredPage(report({ finalDisplayedUrl: 'https://nubandina-dev.myshopify.com/?preview_theme_id=111' }), expected); }).toThrow(/preview_theme_id=222/);
    expect(() => { assertMeasuredPage(report({ finalDisplayedUrl: 'https://nubandina-dev.myshopify.com/collections/all?preview_theme_id=222' }), expected); }).toThrow(/path \//);
    expect(() => { assertMeasuredPage(report({ finalDisplayedUrl: 'https://other-store.myshopify.com/?preview_theme_id=222' }), expected); }).toThrow(/nubandina-dev\.myshopify\.com/);
    expect(() => { assertMeasuredPage({}, expected); }).toThrow(/no final URL/);
    expect(() => { assertMeasuredPage(report(), expected); }).not.toThrow();
  });
});

describe('the Lighthouse process', () => {
  it('gets only the environment pnpm and Chrome need, never a .env secret', () => {
    const env = childEnv({
      PATH: '/usr/bin', HOME: '/home/a', TMPDIR: '/tmp/x', CHROME_PATH: '/opt/chrome', PNPM_HOME: '/home/a/pnpm',
      SHOPIFY_ACCESS_TOKEN: 'shpat_example', SHOPIFY_CLIENT_SECRET: 'secret', SHOPIFY_STOREFRONT_PASSWORD: 'hunter2-example',
      GOOGLE_OAUTH_CLIENT_SECRET: 'g', NGROK_AUTHTOKEN: 'n', POSTGRES_PASSWORD: 'p', N8N_ENCRYPTION_KEY: 'k', LANG: undefined,
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/a', TMPDIR: '/tmp/x', CHROME_PATH: '/opt/chrome', PNPM_HOME: '/home/a/pnpm' });
  });

  it('Ctrl+C removes the cookie file and re-raises the signal', async () => {
    const fake = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() });
    let secretsDir = '';
    let resume: () => void = () => undefined;
    const pending = withSecretsDir((dir) => {
      secretsDir = dir;
      writeFileSync(join(dir, 'headers.json'), '{}');
      return new Promise<void>((resolve) => { resume = resolve; });
    }, fake);
    await vi.waitFor(() => expect(secretsDir).not.toBe(''));
    fake.emit('SIGINT');
    expect(existsSync(secretsDir)).toBe(false);
    expect(fake.kill).toHaveBeenCalledWith(4242, 'SIGINT');
    resume();
    await pending;
    expect(fake.listenerCount('SIGINT') + fake.listenerCount('SIGTERM')).toBe(0);
  });

  it('the cookie directory is removed after a normal or failed run', async () => {
    const fake = Object.assign(new EventEmitter(), { pid: 1, kill: vi.fn() });
    let secretsDir = '';
    await expect(withSecretsDir((dir) => { secretsDir = dir; return Promise.reject(new Error('boom')); }, fake)).rejects.toThrow('boom');
    expect(existsSync(secretsDir)).toBe(false);
    expect(fake.kill).not.toHaveBeenCalled();
  });
});
