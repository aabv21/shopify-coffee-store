// The offline theme preview's pure parts: mock data shaped from data/products.csv, the theme's
// resolved settings, the Horizon CSS variables the components rely on, and a liquidjs engine with
// the few Shopify-only tags and filters the two component files use. Everything here is an
// approximation of what Shopify renders; `shopify theme dev` against a store is the real check.
import { parse } from 'csv-parse/sync';
import { Liquid, Tag, TypeGuards, type TagToken, type TopLevelToken } from 'liquidjs';
import { formatMoney } from '../../src/theme/money.ts';

// ---------------------------------------------------------------------------------------------
// Mock catalog
// ---------------------------------------------------------------------------------------------

export interface MockVariant { id: number; title: string; weight: number; available: boolean; price: number }
export interface MockImage { src: string; alt: string }
interface MockMetafield { value: string | null }
export interface MockProduct {
  id: number;
  handle: string;
  title: string;
  url: string;
  featured_image: MockImage | null;
  metafields: { coffee: { roast: MockMetafield; tasting_notes: MockMetafield; brew_method: MockMetafield } };
  variants: MockVariant[];
}

const COLUMN = {
  title: 'Title',
  handle: 'URL handle',
  status: 'Status',
  option: 'Option1 value',
  price: 'Price',
  quantity: 'Inventory quantity',
  policy: 'Continue selling when out of stock',
  grams: 'Weight value (grams)',
  image: 'Product image URL',
  alt: 'Image alt text',
  roast: 'Roast (product.metafields.coffee.roast)',
  notes: 'Tasting notes (product.metafields.coffee.tasting_notes)',
  method: 'Brew method (product.metafields.coffee.brew_method)',
} as const;

// Synthetic ids: Shopify assigns real ones on import. Distinct ranges keep a product id from ever
// being mistaken for a variant id in the rendered JSON.
const FIRST_PRODUCT_ID = 1001;
const FIRST_VARIANT_ID = 2001;

function cell(row: Record<string, string>, column: string): string {
  // eslint-disable-next-line security/detect-object-injection -- column is one of COLUMN's fixed header names
  return row[column]?.trim() ?? '';
}

function metafield(value: string): MockMetafield {
  return { value: value === '' ? null : value };
}

function wholeNumber(value: string, what: string): number {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new Error(`products.csv: ${what} is not a number: "${value}"`);
  return n;
}

/**
 * Shapes Shopify's product-import CSV into the product objects the coffee finder's Liquid reads:
 * one product per `URL handle` (its first row carries the title, image, and metafields), one
 * variant per row. Prices become cents (Shopify's `variant.price`), and a variant is available
 * when it has stock or keeps selling when out of stock. Only `Active` products are listed, as on
 * a storefront.
 */
export function parseCatalog(csv: string): MockProduct[] {
  const rows = parse<Record<string, string>>(csv, { columns: true, bom: true, skip_empty_lines: true });
  const byHandle = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const handle = cell(row, COLUMN.handle);
    if (handle === '') throw new Error('products.csv: a row has no URL handle');
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), row]);
  }

  const products: MockProduct[] = [];
  let productId = FIRST_PRODUCT_ID;
  let variantId = FIRST_VARIANT_ID;
  for (const [handle, group] of byHandle) {
    const [first] = group;
    if (!first || cell(first, COLUMN.title) === '') throw new Error(`products.csv: ${handle}'s first row has no Title`);
    const id = productId++;
    const variants = group.map((row) => ({
      id: variantId++,
      title: cell(row, COLUMN.option),
      weight: wholeNumber(cell(row, COLUMN.grams), `${handle} weight`),
      available: wholeNumber(cell(row, COLUMN.quantity), `${handle} inventory`) > 0 || cell(row, COLUMN.policy) === 'CONTINUE',
      price: Math.round(wholeNumber(cell(row, COLUMN.price), `${handle} price`) * 100),
    }));
    if (cell(first, COLUMN.status) !== 'Active') continue;

    const image = cell(first, COLUMN.image);
    products.push({
      id,
      handle,
      title: cell(first, COLUMN.title),
      url: `/products/${handle}`,
      featured_image: image === '' ? null : { src: image, alt: cell(first, COLUMN.alt) },
      metafields: {
        coffee: {
          roast: metafield(cell(first, COLUMN.roast)),
          tasting_notes: metafield(cell(first, COLUMN.notes)),
          brew_method: metafield(cell(first, COLUMN.method)),
        },
      },
      variants,
    });
  }
  return products;
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export type Settings = Readonly<Record<string, unknown>>;

const PALETTE_REFERENCE = /^\{\{\s*settings\.(\w+)\.(\w+)\s*\}\}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The settings a storefront would see: every `settings_schema.json` default, overlaid with
 * `settings_data.json`'s `current` values (or the preset it names), with each
 * `{{ settings.<palette>.<key> }}` reference resolved to the palette color it points at.
 */
export function resolveSettings(schema: unknown, data: unknown): Settings {
  if (!Array.isArray(schema)) throw new Error('settings_schema.json: expected an array of groups');
  const merged = new Map<string, unknown>();
  for (const group of schema) {
    if (!isRecord(group) || !Array.isArray(group.settings)) continue;
    for (const setting of group.settings) {
      if (isRecord(setting) && typeof setting.id === 'string' && 'default' in setting) merged.set(setting.id, setting.default);
    }
  }

  if (!isRecord(data)) throw new Error('settings_data.json: expected an object');
  const presets = isRecord(data.presets) ? new Map(Object.entries(data.presets)) : new Map<string, unknown>();
  const current = typeof data.current === 'string' ? presets.get(data.current) : data.current;
  if (!isRecord(current)) throw new Error('settings_data.json: no current settings');
  for (const [id, value] of Object.entries(current)) merged.set(id, value);

  const resolved = new Map<string, unknown>();
  for (const [id, value] of merged) {
    const match = typeof value === 'string' ? PALETTE_REFERENCE.exec(value) : null;
    if (!match) {
      resolved.set(id, value);
      continue;
    }
    const [, groupId = '', key = ''] = match;
    const palette = merged.get(groupId);
    const color = isRecord(palette) ? new Map(Object.entries(palette)).get(key) : undefined;
    if (typeof color !== 'string') throw new Error(`settings: ${id} references ${groupId}.${key}, which does not exist`);
    resolved.set(id, color);
  }
  return Object.fromEntries(resolved);
}

/** One setting's value by its fixed Horizon id; undefined when it isn't set. */
export function setting(settings: Settings, id: string): unknown {
  // eslint-disable-next-line security/detect-object-injection -- id is a fixed Horizon setting name, read only when present
  return Object.hasOwn(settings, id) ? settings[id] : undefined;
}

const SCHEMA_TAG = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

/** A section's `{% schema %}` setting defaults, as the section's `section.settings` on first add. */
export function sectionSettingDefaults(source: string): Record<string, unknown> {
  const match = SCHEMA_TAG.exec(source);
  if (!match?.[1]) throw new Error('section has no {% schema %} tag');
  const schema = JSON.parse(match[1]) as { settings?: unknown };
  const defaults = new Map<string, unknown>();
  for (const entry of Array.isArray(schema.settings) ? schema.settings : []) {
    if (isRecord(entry) && typeof entry.id === 'string' && 'default' in entry) defaults.set(entry.id, entry.default);
  }
  return Object.fromEntries(defaults);
}

// ---------------------------------------------------------------------------------------------
// Colors and fonts
// ---------------------------------------------------------------------------------------------

export interface Rgb { r: number; g: number; b: number }

export function parseHex(value: unknown): Rgb {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new Error(`expected a #rgb or #rrggbb color, got ${JSON.stringify(value)}`);
  }
  const hex = value.length === 4 ? value.slice(1).replace(/./g, (c) => c + c) : value.slice(1);
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const channels = ({ r, g, b }: Rgb): string => `${r.toString()} ${g.toString()} ${b.toString()}`;

/** Shopify's `color_brightness`: perceived brightness, 0–255. */
export function brightness({ r, g, b }: Rgb): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `foreground` at `alpha` opacity over `background`, as the eye sees it. */
export function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  const mix = (f: number, b: number): number => Math.round(f * alpha + b * (1 - alpha));
  return { r: mix(foreground.r, background.r), g: mix(foreground.g, background.g), b: mix(foreground.b, background.b) };
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to255 = (v: number): number => Math.round((v + m) * 255);
  return { r: to255(r1), g: to255(g1), b: to255(b1) };
}

/** Shopify's `color_lighten` / `color_darken`: moves HSL lightness by `amount` percentage points. */
export function shiftLightness(color: Rgb, amount: number): Rgb {
  const hsl = toHsl(color);
  return fromHsl({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + amount / 100)) });
}

/** Horizon's `util-palette-hover-shift` for an opaque color. */
export function hoverShift(color: Rgb): Rgb {
  const b = brightness(color);
  if (b <= 40) return shiftLightness(color, 15);
  if (b <= 128) return shiftLightness(color, 5);
  if (b <= 190) return shiftLightness(color, -10);
  return shiftLightness(color, -5);
}

interface PreviewFont { family: string; fallback: string }

// The Shopify font library families this preview can stand in for. Shopify serves them from its
// own font CDN; the preview loads the same families from Google Fonts. An unlisted family fails
// loudly instead of silently rendering in a system font.
export const PREVIEW_FONTS: ReadonlyMap<string, PreviewFont> = new Map([
  ['alegreya', { family: 'Alegreya', fallback: 'serif' }],
  ['alegreya_sans', { family: 'Alegreya Sans', fallback: 'sans-serif' }],
  ['inter', { family: 'Inter', fallback: 'sans-serif' }],
]);

export interface FontHandle { key: string; family: string; fallback: string; weight: number; style: 'normal' | 'italic' }

/** Parses a Shopify font handle such as `alegreya_sans_n4` (family, `n`/`i` style, weight / 100). */
export function parseFontHandle(handle: unknown): FontHandle {
  const match = typeof handle === 'string' ? /^([a-z0-9_]+)_([ni])([1-9])$/.exec(handle) : null;
  if (!match) throw new Error(`not a Shopify font handle: ${JSON.stringify(handle)}`);
  const [, key = '', style, weight = '4'] = match;
  const font = PREVIEW_FONTS.get(key);
  if (!font) throw new Error(`font ${String(handle)} is not in PREVIEW_FONTS; add its family to preview it`);
  return { key, ...font, weight: Number(weight) * 100, style: style === 'i' ? 'italic' : 'normal' };
}

const FONT_ROLES = ['body', 'subheading', 'heading', 'accent'] as const;

/** A Google Fonts stylesheet URL for every font role, in its own weight and bold (Horizon's `font_modify: 'weight', 'bold'`). */
export function previewFontsUrl(settings: Settings): string {
  const weights = new Map<string, Set<number>>();
  for (const role of FONT_ROLES) {
    const font = parseFontHandle(setting(settings, `type_${role}_font`));
    const set = weights.get(font.family) ?? new Set<number>();
    set.add(font.weight).add(700);
    weights.set(font.family, set);
  }
  const families = [...weights].map(([family, set]) => `family=${family.replaceAll(' ', '+')}:wght@${[...set].sort((a, b) => a - b).join(';')}`);
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

// ---------------------------------------------------------------------------------------------
// CSS variables
// ---------------------------------------------------------------------------------------------

const REQUIRED_STATIC_VARIABLES = ['--gap-md', '--font-size--sm', '--focus-outline-width', '--opacity-10', '--animation-speed'];

/**
 * The Liquid-free part of Horizon's `snippets/theme-styles-variables.liquid` `:root` block (gaps,
 * fixed font sizes, opacities, focus, motion, ...), copied verbatim so the preview never drifts
 * from the pinned Horizon. Any line that contains Liquid is dropped; `themeCssVariables` computes
 * the settings-driven values instead. Throws when the block or a variable the components use is
 * missing, which means Horizon restructured the file.
 */
export function staticRootVariables(source: string): string {
  const start = source.indexOf(':root {');
  if (start === -1) throw new Error('theme-styles-variables.liquid: no :root block');

  const kept: string[] = [];
  let depth = 0;
  let inLiquidTag = false;
  for (const line of source.slice(start).split('\n')) {
    if (inLiquidTag) {
      if (line.includes('%}')) inLiquidTag = false;
      continue;
    }
    if (line.includes('{%') && !line.includes('%}')) {
      inLiquidTag = true;
      continue;
    }
    if (line.includes('{{') || line.includes('{%')) continue;

    kept.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth === 0) break;
  }

  const css = kept.join('\n');
  const missing = REQUIRED_STATIC_VARIABLES.filter((name) => !css.includes(`${name}:`));
  if (missing.length > 0) throw new Error(`theme-styles-variables.liquid: missing ${missing.join(', ')}`);
  return css;
}

const TYPE_PRESETS = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const FLUID_SIZE_CUTOFF = 48;
const ABSOLUTE_FONT_SIZE_MIN = 10;

const rem = (px: number): string => `${Number((px / 16).toFixed(4)).toString()}rem`;

/** Horizon's type-preset sizes: fixed below 48px, a `clamp()` from the next smaller size above it. */
export function presetFontSizes(settings: Settings): Record<string, string> {
  const sizes = new Map(TYPE_PRESETS.map((preset) => [preset, Number(setting(settings, `type_size_${preset}`))]));
  const sorted = [...new Set(sizes.values())].sort((a, b) => a - b);
  const result = new Map<string, string>();
  for (const [preset, size] of sizes) {
    if (!Number.isFinite(size) || size <= 0) throw new Error(`settings: type_size_${preset} is not a size`);
    if (size < FLUID_SIZE_CUTOFF) {
      result.set(preset, rem(size));
      continue;
    }
    const next = sorted[sorted.indexOf(size) - 1];
    let min = ABSOLUTE_FONT_SIZE_MIN;
    if (next !== undefined) min = next < FLUID_SIZE_CUTOFF ? Math.min(next + 4, size) : next;
    result.set(preset, `clamp(${rem(min)}, ${Number((size * 0.1).toFixed(4)).toString()}vw, ${rem(size)})`);
  }
  return Object.fromEntries(result);
}

const rgbFunction = (color: Rgb): string => `rgb(${channels(color)} / 1.0)`;

/**
 * The settings-driven Horizon CSS variables the components and the base styles they rely on read:
 * colors (Horizon's `snippets/color-palette.liquid`), fonts and type presets, radii, and button
 * fonts (`snippets/theme-styles-variables.liquid`). Values follow Horizon's Liquid formulas for
 * opaque colors; anything else (semi-transparent colors, per-section overrides) is out of scope.
 */
export function themeCssVariables(settings: Settings): string {
  const vars: [string, string][] = [];
  const color = (id: string): Rgb => parseHex(setting(settings, id));

  const background = color('page_background_color');
  const foreground = color('page_text_color');
  const paletteSetting = setting(settings, 'color_palette');
  const palette = isRecord(paletteSetting) ? Object.values(paletteSetting).map(parseHex) : [];
  if (palette.length < 2) throw new Error('settings: color_palette needs at least two colors');
  const lightest = palette.reduce((a, b) => (brightness(b) > brightness(a) ? b : a));
  const darkest = palette.reduce((a, b) => (brightness(b) < brightness(a) ? b : a));
  const dark = brightness(background) < 64;

  vars.push(
    ['--color-background', toHex(background)],
    ['--color-background-rgb', channels(background)],
    ['--color-foreground', toHex(foreground)],
    ['--color-foreground-rgb', channels(foreground)],
    ['--color-border', toHex(foreground)],
    ['--color-border-rgb', channels(foreground)],
    ['--palette-lightest', toHex(lightest)],
    ['--palette-lightest-rgb', channels(lightest)],
    ['--palette-darkest', toHex(darkest)],
    ['--palette-darkest-rgb', channels(darkest)],
    ['--opacity-5-15', dark ? '0.15' : '0.05'],
    ['--opacity-10-25', dark ? '0.25' : '0.1'],
    ['--opacity-35-55', dark ? '0.55' : '0.35'],
    ['--opacity-40-60', dark ? '0.60' : '0.40'],
    ['--opacity-30-60', dark ? '0.60' : '0.30'],
  );

  for (const kind of ['primary', 'secondary'] as const) {
    const text = color(`palette_${kind}_button_text`);
    const fill = color(`palette_${kind}_button_background`);
    const border = color(`palette_${kind}_button_border`);
    const hoverFill = hoverShift(fill);
    const hoverText = brightness(hoverFill) > 128 ? darkest : lightest;
    const hoverBorder = toHex(border) === toHex(fill) ? hoverFill : hoverShift(border);
    vars.push(
      [`--color-${kind}-button-text`, rgbFunction(text)],
      [`--color-${kind}-button-background`, rgbFunction(fill)],
      [`--color-${kind}-button-border`, rgbFunction(border)],
      [`--color-${kind}-button-hover-text`, rgbFunction(hoverText)],
      [`--color-${kind}-button-hover-background`, toHex(hoverFill)],
      [`--color-${kind}-button-hover-border`, toHex(hoverBorder)],
    );
    if (kind === 'primary') vars.push(['--color-primary-button-focus-outline', `rgb(${channels(fill)})`]);
  }

  const inputText = color('palette_input_text');
  vars.push(
    ['--color-input-background', rgbFunction(color('palette_input_background'))],
    ['--color-input-text', rgbFunction(inputText)],
    ['--color-input-text-rgb', channels(inputText)],
    ['--color-input-border', rgbFunction(color('palette_input_border'))],
    ['--color-foreground-muted', 'rgb(var(--color-rgb, var(--color-foreground-rgb)) / var(--opacity-muted-text))'],
    ['--color-foreground-subdued', 'rgb(var(--color-rgb, var(--color-foreground-rgb)) / var(--opacity-subdued-text))'],
  );

  for (const role of FONT_ROLES) {
    const font = parseFontHandle(setting(settings, `type_${role}_font`));
    vars.push(
      [`--font-${role}--family`, `"${font.family}", ${font.fallback}`],
      [`--font-${role}--style`, font.style],
      [`--font-${role}--weight`, font.weight.toString()],
    );
  }

  const sizes = new Map(Object.entries(presetFontSizes(settings)));
  const text = (id: string): string => String(setting(settings, id));
  for (const preset of TYPE_PRESETS) {
    const font = preset === 'paragraph' ? 'body' : text(`type_font_${preset}`);
    vars.push(
      [`--font-size--${preset}`, sizes.get(preset) ?? ''],
      [`--font-${preset}--size`, `var(--font-size--${preset})`],
      [`--font-${preset}--family`, `var(--font-${font}--family)`],
      [`--font-${preset}--style`, `var(--font-${font}--style)`],
      [`--font-${preset}--weight`, preset === 'paragraph' ? '400' : `var(--font-${font}--weight)`],
      [`--font-${preset}--line-height`, `var(--line-height--${text(`type_line_height_${preset}`)})`],
      [`--font-${preset}--case`, preset === 'paragraph' ? 'none' : text(`type_case_${preset}`)],
    );
    if (preset !== 'paragraph') vars.push([`--font-${preset}--letter-spacing`, `var(--letter-spacing--${text(`type_letter_spacing_${preset}`)})`]);
  }

  const px = (id: string): string => `${text(id)}px`;
  vars.push(
    ['--style-border-radius-pills', px('pills_border_radius')],
    ['--style-border-radius-inputs', px('inputs_border_radius')],
    ['--style-border-radius-buttons-primary', px('button_border_radius_primary')],
    ['--style-border-radius-buttons-secondary', px('button_border_radius_secondary')],
    ['--style-border-width-primary', px('primary_button_border_width')],
    ['--style-border-width-secondary', px('secondary_button_border_width')],
    ['--style-border-width-inputs', px('input_border_width')],
    ['--style-border-radius-popover', px('popover_border_radius')],
    ['--button-font-family-primary', `var(--font-${text('type_font_button_primary')}--family)`],
    ['--button-font-family-secondary', `var(--font-${text('type_font_button_secondary')}--family)`],
    ['--button-text-case-primary', text('button_text_case_primary')],
    ['--button-text-case-secondary', text('button_text_case_secondary')],
  );

  return `:root {\n${vars.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`;
}

// ---------------------------------------------------------------------------------------------
// Liquid engine
// ---------------------------------------------------------------------------------------------

/**
 * A block tag whose body is not Liquid: collects the raw text up to `end<name>` and hands it to
 * `onRender` each time it renders, printing nothing in place.
 */
function rawBlockTag(name: string, onRender: (text: string) => void): new (token: TagToken, remain: TopLevelToken[], liquid: Liquid) => Tag {
  return class extends Tag {
    readonly #text: string;

    constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
      super(token, remainTokens, liquid);
      const parts: string[] = [];
      for (;;) {
        const next = remainTokens.shift();
        if (!next) throw new Error(`tag ${token.getText()} not closed`);
        if (TypeGuards.isTagToken(next) && next.name === `end${name}`) break;
        parts.push(next.getText());
      }
      this.#text = parts.join('');
    }

    render(): void {
      onRender(this.#text);
    }
  };
}

/** A keyword argument's value from liquidjs's `[key, value]` tuples, such as `width: 400`. */
function keywordArgument(args: readonly unknown[], key: string): unknown {
  for (const arg of args) {
    if (Array.isArray(arg) && arg[0] === key) return arg[1];
  }
  return undefined;
}

export interface PreviewEngine { engine: Liquid; stylesheets: () => string[] }

/**
 * A liquidjs engine with only the Shopify tags and filters the two component files use, each
 * listed in theme/README.md. `strictFilters` makes any other Shopify-only filter a render error,
 * so a component that starts using one fails the preview instead of rendering it wrongly.
 */
export function createPreviewEngine(o: { moneyFormat: string; assetUrl: (name: string) => string }): PreviewEngine {
  const engine = new Liquid({ strictFilters: true });
  const stylesheets = new Set<string>();

  engine.registerTag('schema', rawBlockTag('schema', () => undefined));
  engine.registerTag('doc', rawBlockTag('doc', () => undefined));
  engine.registerTag('stylesheet', rawBlockTag('stylesheet', (css) => stylesheets.add(css.trim())));

  engine.registerFilter('money', (cents: unknown) => formatMoney(Number(cents), o.moneyFormat));
  engine.registerFilter('asset_url', (name: unknown) => o.assetUrl(String(name)));
  engine.registerFilter('image_url', (image: unknown, ...args: unknown[]) => {
    const src = isRecord(image) && typeof image.src === 'string' ? image.src : String(image);
    const width = keywordArgument(args, 'width');
    if (width === undefined) return src;
    if (typeof width !== 'number' && typeof width !== 'string') throw new Error('image_url: width must be a number');
    const url = new URL(src);
    url.searchParams.set('width', String(width));
    return url.toString();
  });

  return { engine, stylesheets: () => [...stylesheets] };
}

export interface PreviewScope {
  section: { id: string; settings: Record<string, unknown> };
  settings: Settings;
  collections: { all: { products: MockProduct[] } };
  routes: Record<string, string>;
  shop: { money_format: string };
  cart: { total_price: number };
}

/** The Liquid globals the two component files read, with a cart total in cents. */
export function previewScope(o: {
  products: MockProduct[];
  sectionSettings: Record<string, unknown>;
  settings: Settings;
  moneyFormat: string;
  cartTotalCents: number;
}): PreviewScope {
  return {
    section: { id: 'coffee_finder', settings: o.sectionSettings },
    settings: o.settings,
    collections: { all: { products: o.products } },
    routes: { root_url: '/', cart_url: '/cart', cart_add_url: '/cart/add', all_products_collection_url: '/collections/all' },
    shop: { money_format: o.moneyFormat },
    cart: { total_price: o.cartTotalCents },
  };
}
