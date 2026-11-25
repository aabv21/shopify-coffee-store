// The offline preview's pure parts. Everything here approximates Shopify's renderer;
// `shopify theme dev` against a store is the real check.
import { Liquid, Tag, TypeGuards, type TagToken, type TopLevelToken } from 'liquidjs';
import { formatMoney } from '../../src/theme/money.ts';
import type { MockProduct } from './catalog.ts';

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export type Settings = Readonly<Record<string, unknown>>;

const PALETTE_REFERENCE = /^\{\{\s*settings\.(\w+)\.(\w+)\s*\}\}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
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

const HTML_ESCAPES = new Map([['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]);
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char);

/**
 * A translation by its dotted key from one parsed locale file, with Shopify's `{{ name }}`
 * interpolation. Throws when the key isn't a string in that file: there is no fallback to English,
 * so a string missing from the Spanish file can't hide behind its English one.
 */
export function translate(translations: unknown, key: string, variables: Readonly<Record<string, unknown>> = {}): string {
  let node: unknown = translations;
  for (const part of key.split('.')) node = isRecord(node) ? new Map(Object.entries(node)).get(part) : undefined;
  if (typeof node !== 'string') throw new Error(`translation missing: ${key}`);
  const values = new Map(Object.entries(variables));
  return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (values.has(name) ? String(values.get(name)) : match));
}

export interface PreviewEngine { engine: Liquid; stylesheets: () => string[] }

/**
 * A liquidjs engine with only the Shopify tags and filters the two component files use, each
 * listed in theme/README.md. `strictFilters` makes any other Shopify-only filter a render error,
 * so a component that starts using one fails the preview instead of rendering it wrongly. `render`
 * reads snippets from `snippetsDir`; `t` reads `translations` (one parsed locale file) and, as
 * Shopify documents, escapes its output unless the key ends in `_html`.
 */
export function createPreviewEngine(o: {
  moneyFormat: string;
  assetUrl: (name: string) => string;
  snippetsDir: string;
  locale: string;
  translations: unknown;
}): PreviewEngine {
  const engine = new Liquid({ strictFilters: true, root: [o.snippetsDir], extname: '.liquid' });
  const stylesheets = new Set<string>();

  engine.registerTag('schema', rawBlockTag('schema', () => undefined));
  engine.registerTag('doc', rawBlockTag('doc', () => undefined));
  engine.registerTag('stylesheet', rawBlockTag('stylesheet', (css) => stylesheets.add(css.trim())));

  engine.registerFilter('t', (key: unknown, ...args: unknown[]) => {
    const name = String(key);
    const variables = Object.fromEntries(args.filter((arg): arg is [string, unknown] => Array.isArray(arg) && typeof arg[0] === 'string'));
    let text: string;
    try {
      text = translate(o.translations, name, variables);
    } catch {
      throw new Error(`translation missing: ${o.locale}.${name}`);
    }
    return name.endsWith('_html') ? text : escapeHtml(text);
  });
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
