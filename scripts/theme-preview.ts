import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocale, type Locale } from '../src/lib/locale.ts';
import { formatMoney } from '../src/theme/money.ts';
import { assembleTheme } from './assemble-theme.ts';
import { ensureHorizon } from './lib/horizon.ts';
import { parseJsonc } from './lib/jsonc.ts';
import { INSERTIONS, splitLeadingComment } from './lib/theme-insertions.ts';
import {
  createPreviewEngine,
  parseCatalog,
  previewFontsUrl,
  previewScope,
  resolveSettings,
  sectionSettingDefaults,
  staticRootVariables,
  themeCssVariables,
  translate,
} from './lib/theme-preview.ts';

const CACHE_ROOT = '.theme-build';
const THEME_DIR = '.theme-build/theme';
const OVERLAY_DIR = 'theme';
const PREVIEW_DIR = '.theme-build/preview';
const CATALOG = 'data/products.csv';

// docs/shopify-setup.md's "HTML without currency" format for the store's COP prices.
export const MONEY_FORMAT = '${{amount_no_decimals_with_comma_separator}}';

const PREVIEW_ASSETS = ['base.css', 'coffee-finder.js', 'free-shipping-bar.js'];

// Fractions of the free-shipping threshold.
export const CART_PROGRESS = [0, 0.6, 1] as const;

// Preview-only: resolves after a delay, so the add button's busy and added states are visible.
const SHOPIFY_ACTIONS_STUB = `window.Shopify = window.Shopify || {};
window.Shopify.actions = {
  updateCart: () => new Promise((resolve) => setTimeout(() => resolve({ userErrors: [], warnings: [] }), 800)),
  openCart: () => Promise.resolve(),
};`;

// ?demo=<name> shows one state, for screenshots.
const DEMO_FILTER = `const demo = new URLSearchParams(location.search).get('demo');
if (demo) for (const el of document.querySelectorAll('[data-preview-demo]')) el.hidden = el.dataset.previewDemo !== demo;`;

// The approximation notice and the mock cart panel, in Horizon tokens only.
const SCAFFOLD_CSS = `
[data-preview-demo][hidden] { display: none; }
.preview-banner {
  background-color: rgb(var(--color-foreground-rgb) / var(--opacity-5));
  border-block-end: var(--style-border-width) solid rgb(var(--color-foreground-rgb) / var(--opacity-15));
  font-size: var(--font-size--sm);
}
.preview-banner__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--gap-md);
  row-gap: var(--gap-2xs);
  max-inline-size: var(--narrow-page-width);
  margin-inline: auto;
  padding: var(--padding-xs) var(--page-margin);
}
.preview-banner__title { margin: 0; font-family: var(--font-body--family); font-size: inherit; font-weight: 700; line-height: 1.4; }
.preview-banner details { flex: 1 1 18rem; }
.preview-banner summary { padding-block: 0; min-block-size: 24px; text-decoration: underline; text-underline-offset: 0.2em; inline-size: fit-content; }
.preview-banner details p { margin-block: var(--margin-xs); max-inline-size: 70ch; }
.preview-banner ul { display: flex; flex-wrap: wrap; gap: var(--gap-md); margin: 0; padding: 0; list-style: none; }
.preview-banner a { text-decoration-color: currentcolor; }
.preview-cart { padding-block: var(--padding-4xl); }
.preview-cart__panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xl);
  inline-size: 100%;
  max-inline-size: var(--drawer-max-width);
  margin-inline: auto;
  padding: var(--drawer-padding);
  border: var(--style-border-width) solid rgb(var(--color-foreground-rgb) / var(--opacity-15));
  border-radius: var(--style-border-radius-popover);
}
.preview-cart__title { margin: 0; }
.preview-cart__total { display: flex; justify-content: space-between; margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.preview-cart__checkout { inline-size: 100%; }
`;

export interface PreviewBar { percent: number; totalCents: number; html: string }

/** From Horizon's locale keys for its real cart drawer. */
export interface CartLabels { title: string; total: string; checkout: string }

const LOCALE_FILES: ReadonlyMap<Locale, string> = new Map([['en', 'locales/en.default.json'], ['es', 'locales/es.json']]);

export function parsePreviewArgs(argv: readonly string[]): { locale: Locale } {
  const index = argv.findIndex((arg) => arg === '--locale' || arg.startsWith('--locale='));
  if (index === -1) return { locale: 'en' };
  const flag = argv.at(index) ?? '';
  const value = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : argv.at(index + 1);
  if (!isLocale(value)) throw new Error('--locale must be en or es');
  return { locale: value };
}

const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function previewPage(o: {
  fontsUrl: string;
  pageWidth: string;
  staticVariables: string;
  themeVariables: string;
  componentCss: readonly string[];
  finderHtml: string;
  bars: readonly PreviewBar[];
  locale: Locale;
  cartLabels: CartLabels;
}): string {
  const demos = [
    { name: 'finder', label: 'Coffee finder' },
    ...o.bars.map((bar) => ({ name: `cart-${bar.percent.toString()}`, label: `Cart at ${bar.percent.toString()}%` })),
  ];
  const nav = demos.map((demo) => `<li><a href="?demo=${demo.name}">${demo.label}</a></li>`).join('');
  const bars = o.bars
    .map((bar) => {
      const id = `preview-cart-${bar.percent.toString()}`;
      return `
    <section class="section section--page-width preview-cart" data-preview-demo="cart-${bar.percent.toString()}" aria-labelledby="${id}">
      <div class="preview-cart__panel">
        <h2 class="h4 preview-cart__title" id="${id}">${escapeHtml(o.cartLabels.title)}</h2>
        ${bar.html}
        <p class="preview-cart__total"><span>${escapeHtml(o.cartLabels.total)}</span><span>${escapeHtml(formatMoney(bar.totalCents, MONEY_FORMAT))}</span></p>
        <button type="button" class="button preview-cart__checkout">${escapeHtml(o.cartLabels.checkout)}</button>
      </div>
    </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="${o.locale}" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Nubandina theme preview (approximation)</title>
    <link rel="icon" href="data:,">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="${escapeHtml(o.fontsUrl)}">
    <link rel="stylesheet" href="assets/base.css">
    <style>
${o.staticVariables}
${o.themeVariables}
    </style>
    <style>
${o.componentCss.join('\n\n')}
    </style>
    <style>${SCAFFOLD_CSS}</style>
    <script>${SHOPIFY_ACTIONS_STUB}</script>
  </head>
  <body class="page-width-${escapeHtml(o.pageWidth)}">
    <header class="preview-banner">
      <div class="preview-banner__inner">
        <h1 class="preview-banner__title">Offline preview: an approximation</h1>
        <details>
          <summary>What this preview approximates</summary>
          <p>The real <code>sections/coffee-finder.liquid</code> and <code>snippets/free-shipping-bar.liquid</code> from the assembled theme, rendered with liquidjs in the <code>${o.locale}</code> locale, mock data from <code>data/products.csv</code>, and stubbed Shopify filters. Shopify's renderer, its font CDN, and a real cart can differ; the real check is <code>shopify theme dev</code> against a store.</p>
          <nav aria-label="Preview states"><ul>${nav}</ul></nav>
        </details>
      </div>
    </header>
    <main id="MainContent" class="content-for-layout">
      <div class="shopify-section" id="shopify-section-coffee_finder" data-preview-demo="finder">
${o.finderHtml}
      </div>
${bars}
    </main>
    <script>${DEMO_FILTER}</script>
  </body>
</html>
`;
}

function readText(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixed theme or data file, not user input
  return readFileSync(path, 'utf8');
}

async function main(): Promise<void> {
  const { locale } = parsePreviewArgs(process.argv.slice(2));
  const horizonDir = await ensureHorizon(CACHE_ROOT);
  await assembleTheme({ baseDir: horizonDir, overlayDir: OVERLAY_DIR, outDir: THEME_DIR, insertions: INSERTIONS });
  const theme = (file: string): string => readText(join(THEME_DIR, file));

  const settings = resolveSettings(
    JSON.parse(theme('config/settings_schema.json')),
    JSON.parse(splitLeadingComment(theme('config/settings_data.json')).json),
  );
  const products = parseCatalog(readText(CATALOG));
  const sectionSource = theme('sections/coffee-finder.liquid');
  const snippetSource = theme('snippets/free-shipping-bar.liquid');
  const sectionSettings = sectionSettingDefaults(sectionSource);
  const translations = parseJsonc(theme(LOCALE_FILES.get(locale) ?? 'locales/en.default.json'));
  const { engine, stylesheets } = createPreviewEngine({
    moneyFormat: MONEY_FORMAT,
    assetUrl: (name) => `assets/${name}`,
    snippetsDir: join(THEME_DIR, 'snippets'),
    locale,
    translations,
  });
  const scope = (cartTotalCents: number) => previewScope({ products, sectionSettings, settings, moneyFormat: MONEY_FORMAT, cartTotalCents });

  const thresholdCents = Number(settings.free_shipping_threshold) * 100;
  const finderHtml = (await engine.parseAndRender(sectionSource, scope(0))) as string;
  const bars: PreviewBar[] = [];
  for (const progress of CART_PROGRESS) {
    const totalCents = Math.round(thresholdCents * progress);
    const html = (await engine.parseAndRender(snippetSource, scope(totalCents))) as string;
    bars.push({ percent: Math.round(progress * 100), totalCents, html });
  }

  const html = previewPage({
    fontsUrl: previewFontsUrl(settings),
    pageWidth: String(settings.page_width),
    staticVariables: staticRootVariables(theme('snippets/theme-styles-variables.liquid')),
    themeVariables: themeCssVariables(settings),
    componentCss: stylesheets(),
    finderHtml,
    bars,
    locale,
    cartLabels: {
      title: translate(translations, 'content.your_cart'),
      total: translate(translations, 'content.cart_estimated_total'),
      checkout: translate(translations, 'content.checkout'),
    },
  });

  rmSync(PREVIEW_DIR, { recursive: true, force: true });
  mkdirSync(join(PREVIEW_DIR, 'assets'), { recursive: true });
  for (const asset of PREVIEW_ASSETS) copyFileSync(join(THEME_DIR, 'assets', asset), join(PREVIEW_DIR, 'assets', asset));
  writeFileSync(join(PREVIEW_DIR, 'index.html'), html);
  console.log(`wrote ${PREVIEW_DIR}/index.html in ${locale} (an approximation; serve it with: python3 -m http.server 8765 --directory ${PREVIEW_DIR})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
