import { normalizeLocale, type Locale } from '../lib/locale.ts';
import type { BrewingGuide, BrewingGuides, GuideEmail, GuideText, NormalizedOrder, VariantInfo } from './types.ts';

export interface SelectGuidesInput {
  order: NormalizedOrder;
  variants: VariantInfo[];
  guides: BrewingGuides;
  /** `config.default_locale`, as the workflow reads it: blank or missing means English. */
  default_locale?: string;
}

// Every argument a message receives is already HTML-escaped.
interface Messages {
  subject: string;
  greeting: (firstName: string | null) => string;
  intro: (orderNumber: string) => string;
  roast: (roast: string) => string;
  ratio: string;
  signOff: string;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: 'How to brew your Nubandina coffee',
    greeting: (firstName) => `Hi ${firstName ?? 'there'},`,
    intro: (orderNumber) => `Thanks for your order ${orderNumber}. Here's how to get the best from your coffee.`,
    roast: (roast) => `${roast} roast`,
    ratio: 'Ratio',
    signOff: 'Enjoy your coffee,',
  },
  es: {
    subject: 'Cómo preparar su café Nubandina',
    greeting: (firstName) => (firstName === null ? 'Hola:' : `Hola, ${firstName}:`),
    intro: (orderNumber) => `Gracias por su pedido ${orderNumber}. Así puede sacarle el máximo provecho a su café.`,
    roast: (roast) => `tostión ${new Map([['light', 'clara'], ['medium', 'media'], ['dark', 'oscura']]).get(roast) ?? roast}`,
    ratio: 'Proporción',
    signOff: 'Que disfrute su café,',
  },
};

const ESCAPE_RE = /[&<>"']/g;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value: string): string {
  // eslint-disable-next-line security/detect-object-injection -- char is always one of ESCAPE_RE's own fixed characters
  return value.replace(ESCAPE_RE, (char) => ESCAPES[char] ?? char);
}

function productListItem(variant: VariantInfo, m: Messages): string {
  const roastSuffix = variant.roast === null ? '' : `, ${m.roast(escapeHtml(variant.roast))}`;
  return `<li>${escapeHtml(variant.product_title)} (${escapeHtml(variant.variant_title)})${roastSuffix}</li>`;
}

function guideText(guide: BrewingGuide, locale: Locale): GuideText {
  // eslint-disable-next-line security/detect-object-injection -- locale is always one of LOCALES
  return locale === 'en' ? guide : (guide.translations?.[locale] ?? guide);
}

function guideSection(guide: GuideText, m: Messages): string {
  const steps = guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  return `<h2>${escapeHtml(guide.name)}</h2><p>${m.ratio}: ${escapeHtml(guide.ratio)}</p><ol>${steps}</ol>`;
}

export function run(input: SelectGuidesInput): GuideEmail {
  const { order, variants, guides } = input;
  const locale = normalizeLocale(order.locale, normalizeLocale(input.default_locale, 'en'));
  // eslint-disable-next-line security/detect-object-injection -- locale is always one of LOCALES
  const m = MESSAGES[locale];

  const byGid = new Map<string, VariantInfo>();
  for (const variant of variants) byGid.set(variant.variant_gid, variant);

  const knownVariants: VariantInfo[] = [];
  const methodGuides = new Map<string, BrewingGuide>();
  for (const line of order.lines) {
    if (line.variant_gid === null) continue;
    const variant = byGid.get(line.variant_gid);
    if (!variant) continue;
    knownVariants.push(variant);
    const method = variant.brew_method;
    if (method === null || methodGuides.has(method)) continue;
    // eslint-disable-next-line security/detect-object-injection -- method is a brew method read from Shopify product metadata, used only to look up a locally defined guide
    const guide = guides[method];
    if (guide !== undefined) methodGuides.set(method, guide);
  }

  const methods = [...methodGuides.keys()];
  const send = order.email !== null && methods.length > 0;

  const productList = `<ul>${knownVariants.map((variant) => productListItem(variant, m)).join('')}</ul>`;
  const guideSections = [...methodGuides.values()].map((guide) => guideSection(guideText(guide, locale), m)).join('');
  const html = [
    `<p>${m.greeting(order.first_name === null ? null : escapeHtml(order.first_name))}</p>`,
    `<p>${m.intro(escapeHtml(order.order_number))}</p>`,
    productList,
    guideSections,
    `<p>${m.signOff}<br>Nubandina Coffee</p>`,
  ].join('');

  return {
    send,
    locale,
    to: order.email,
    subject: m.subject,
    html,
    methods,
  };
}
