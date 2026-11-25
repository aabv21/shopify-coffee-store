// The theme's fixed insertions, brand values, and locale tables: the data `theme-insertions.ts` applies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Insertion, SettingChange } from './theme-insertions.ts';

// color1-color3 keep the roles Horizon's settings_data.json gives them (a dark accent, the
// sold-out badge's tint, and the input and variant borders); color4 is new.
export const BRAND_PALETTE = {
  background: '#FBF7F2', // cream
  foreground: '#2B1B12', // espresso
  color1: '#7C2D12', // roast: primary buttons and selected variants
  color2: '#E7DCCD', // sand: decorative tints only
  color3: '#6B5B4E', // muted: control borders and secondary text
  color4: '#3F6212', // leaf: small badges only
} as const;

// The pinned Horizon version's values: anchors, so a changed Horizon fails assembly instead of mixing designs.
const HORIZON_PALETTE = { background: '#ffffff', foreground: '#000000', color1: '#333333', color2: '#EEF1EA', color3: '#DFDFDF' };

// Each font handle is checked against Shopify's font library list: Alegreya for headings and
// accents, Alegreya Sans for body text and subheadings.
export const BRAND_SETTINGS: readonly SettingChange[] = [
  { id: 'color_palette', from: HORIZON_PALETTE, to: BRAND_PALETTE },
  { id: 'type_body_font', from: 'inter_n4', to: 'alegreya_sans_n4' },
  { id: 'type_subheading_font', from: 'inter_n5', to: 'alegreya_sans_n5' },
  { id: 'type_heading_font', from: 'inter_n7', to: 'alegreya_n5' },
  { id: 'type_accent_font', from: 'inter_n7', to: 'alegreya_n7' },
  // Alegreya Sans has a small x-height; 14px body text reads closer to 12px.
  { id: 'type_size_paragraph', from: '14', to: '16' },
  { id: 'palette_primary_button_background', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_primary_button_border', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_selected_variant_background', to: '{{ settings.color_palette.color1 }}' },
  { id: 'palette_selected_variant_border', to: '{{ settings.color_palette.color1 }}' },
];

// One top-level namespace per locale file, so this repo's strings never collide with Horizon's.
export const LOCALE_NAMESPACE = 'nubandina';

// A path, not a URL: DOM test environments replace the global URL with one node:fs rejects.
export const THEME_LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'theme-locales');

export function readThemeLocale(file: string): Readonly<Record<string, unknown>> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is one of theme-locales/'s own fixed names
  const parsed = JSON.parse(readFileSync(join(THEME_LOCALES_DIR, file), 'utf8')) as Record<string, unknown>;
  const strings = new Map(Object.entries(parsed)).get(LOCALE_NAMESPACE);
  if (typeof strings !== 'object' || strings === null || Object.keys(parsed).length !== 1) {
    throw new Error(`theme-locales/${file}: expected exactly one top-level key, ${LOCALE_NAMESPACE}`);
  }
  return strings as Record<string, unknown>;
}

// Theme check's MatchingTranslations errors on a key missing from any of the pinned Horizon version's locales, so
// each other locale gets the English strings, as Shopify would show. A locale Horizon adds fails
// theme check; one it drops fails assembly.
export const HORIZON_OTHER_STOREFRONT_LOCALES = [
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt',
  'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'ur', 'vi', 'zh-CN', 'zh-TW',
] as const;
export const HORIZON_OTHER_SCHEMA_LOCALES = [
  'ar', 'cs', 'da', 'de', 'fi', 'fr', 'he', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'ur', 'zh-CN', 'zh-TW',
] as const;

function localeInsertions(): Insertion[] {
  const add = (file: string, translations: Readonly<Record<string, unknown>>): Insertion => ({ kind: 'add-locale-namespace', file, namespace: LOCALE_NAMESPACE, translations });
  const storefront = readThemeLocale('en.default.json');
  const schema = readThemeLocale('en.default.schema.json');
  return [
    add('locales/en.default.json', storefront),
    add('locales/es.json', readThemeLocale('es.json')),
    add('locales/en.default.schema.json', schema),
    add('locales/es.schema.json', readThemeLocale('es.schema.json')),
    ...HORIZON_OTHER_STOREFRONT_LOCALES.map((locale) => add(`locales/${locale}.json`, storefront)),
    ...HORIZON_OTHER_SCHEMA_LOCALES.map((locale) => add(`locales/${locale}.schema.json`, schema)),
  ];
}

export const INSERTIONS: readonly Insertion[] = [
  {
    kind: 'before-line',
    file: 'snippets/cart-summary.liquid',
    anchor: '<div class="cart-totals">',
    content: "{% render 'free-shipping-bar' %}",
  },
  {
    kind: 'append-settings-group',
    file: 'config/settings_schema.json',
    group: {
      name: 't:nubandina.free_shipping_bar.name',
      settings: [
        { type: 'checkbox', id: 'free_shipping_bar_enabled', label: 't:nubandina.free_shipping_bar.enabled', default: true },
        {
          type: 'number',
          id: 'free_shipping_threshold',
          label: 't:nubandina.free_shipping_bar.threshold',
          default: 120000,
          info: 't:nubandina.free_shipping_bar.threshold_info',
        },
        // No defaults: a blank message falls back to the storefront translation in each language.
        {
          type: 'text',
          id: 'free_shipping_message_remaining',
          label: 't:nubandina.free_shipping_bar.message_remaining',
          info: 't:nubandina.free_shipping_bar.message_remaining_info',
        },
        {
          type: 'text',
          id: 'free_shipping_message_reached',
          label: 't:nubandina.free_shipping_bar.message_reached',
          info: 't:nubandina.free_shipping_bar.blank_info',
        },
        {
          type: 'text',
          id: 'free_shipping_progress_label',
          label: 't:nubandina.free_shipping_bar.progress_label',
          info: 't:nubandina.free_shipping_bar.blank_info',
        },
      ],
    },
  },
  {
    kind: 'add-section-after',
    file: 'templates/index.json',
    after: 'hero_jVaWmY',
    key: 'coffee_finder',
    section: { type: 'coffee-finder', settings: {} },
  },
  { kind: 'set-theme-settings', file: 'config/settings_data.json', changes: BRAND_SETTINGS },
  {
    // Horizon's muted text is the foreground at 60% opacity: 4.32:1 on the cream background,
    // under WCAG AA's 4.5:1. At 65% it measures 5.06:1.
    kind: 'replace-anchor',
    file: 'snippets/theme-styles-variables.liquid',
    anchor: '--opacity-muted-text: 0.6;',
    content: '--opacity-muted-text: 0.65;',
  },
  ...localeInsertions(),
];
