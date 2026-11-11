// Renders the real theme components through the offline preview engine, so the preview and DOM
// suites test the same markup the store serves.
import { readFileSync } from 'node:fs';
import { INSERTIONS, readThemeLocale } from '../../scripts/lib/theme-insertions.ts';
import { createPreviewEngine, parseCatalog, previewScope, resolveSettings, sectionSettingDefaults, type MockProduct } from '../../scripts/lib/theme-preview.ts';

export const MONEY = '${{amount_no_decimals_with_comma_separator}}';
export const SNIPPETS = 'theme/snippets';
export const catalog = (): MockProduct[] => parseCatalog(readFileSync('data/products.csv', 'utf8'));
export const finderSection = readFileSync('theme/sections/coffee-finder.liquid', 'utf8');
export const barSnippet = readFileSync('theme/snippets/free-shipping-bar.liquid', 'utf8');

// The storefront strings exactly as the insertions add them to en.default.json and es.json.
export const STRINGS = {
  en: { nubandina: readThemeLocale('en.default.json') },
  es: { nubandina: readThemeLocale('es.json') },
} as const;

export const engineFor = (locale: 'en' | 'es' = 'en') =>
  createPreviewEngine({ moneyFormat: MONEY, assetUrl: (name) => `assets/${name}`, snippetsDir: SNIPPETS, locale, translations: STRINGS[locale] });

// The free-shipping settings exactly as the insertion adds them to settings_schema.json.
const freeShippingGroup = INSERTIONS.flatMap((i) => (i.kind === 'append-settings-group' ? [i.group] : []));
export const barSettings = resolveSettings(freeShippingGroup, { current: {} });

const renderSource = async (source: string, o: { locale: 'en' | 'es'; products: MockProduct[]; cartTotalCents: number }): Promise<string> => {
  const { engine } = engineFor(o.locale);
  const scope = previewScope({ products: o.products, sectionSettings: sectionSettingDefaults(finderSection), settings: barSettings, moneyFormat: MONEY, cartTotalCents: o.cartTotalCents });
  return (await engine.parseAndRender(source, scope)) as string;
};

/** The free-shipping bar snippet at a cart total, against the 120,000 COP threshold. */
export const renderBar = (cartTotalCents: number, locale: 'en' | 'es' = 'en'): Promise<string> =>
  renderSource(barSnippet, { locale, products: catalog(), cartTotalCents });

/** The coffee finder section over data/products.csv, or over `o.products` when given. */
export const renderFinder = (o: { locale?: 'en' | 'es'; products?: MockProduct[] } = {}): Promise<string> =>
  renderSource(finderSection, { locale: o.locale ?? 'en', products: o.products ?? catalog(), cartTotalCents: 0 });
