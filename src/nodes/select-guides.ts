import { messagesFor, normalizeLocale, type Locale } from '../lib/locale.ts';
import { brandedEmail, escapeHtml, storeUrl } from './email-shell.ts';
import type { BrewingGuide, BrewingGuides, GuideEmail, GuideText, NormalizedOrder, VariantInfo } from './types.ts';

export interface SelectGuidesInput {
  order: NormalizedOrder;
  variants: VariantInfo[];
  guides: BrewingGuides;
  /** `config.default_locale`, as the workflow reads it: blank or missing means English. */
  default_locale?: string;
  /** `config.shopify.store`: blank or missing means no "Shop again" button. */
  store?: string;
}

// Every argument a message receives is already HTML-escaped.
interface Messages {
  subject: string;
  greeting: (firstName: string | null) => string;
  intro: (orderNumber: string) => string;
  roast: (roast: string) => string;
  ratio: string;
  signOff: string;
  cta: string;
  footer: string;
  /** Receives the raw order number: the shell escapes it. */
  preheader: (orderNumber: string) => string;
}

const ROAST_ES = new Map([['light', 'clara'], ['medium', 'media'], ['dark', 'oscura']]);

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: 'How to brew your Nubandina coffee',
    greeting: (firstName) => `Hi ${firstName ?? 'there'},`,
    intro: (orderNumber) => `Thanks for your order ${orderNumber}. Here's how to get the best from your coffee.`,
    roast: (roast) => `${roast} roast`,
    ratio: 'Ratio',
    signOff: 'Enjoy your coffee.',
    preheader: (orderNumber) => `Your brewing guide for order ${orderNumber}`,
    cta: 'Shop again',
    footer: "You're getting this email because you ordered from Nubandina Coffee.",
  },
  es: {
    subject: 'Cómo preparar su café Nubandina',
    greeting: (firstName) => (firstName === null ? 'Hola:' : `Hola, ${firstName}:`),
    intro: (orderNumber) => `Gracias por su pedido ${orderNumber}. Así puede sacarle el máximo provecho a su café.`,
    roast: (roast) => `tostión ${ROAST_ES.get(roast) ?? roast}`,
    ratio: 'Proporción',
    signOff: 'Que disfrute su café.',
    preheader: (orderNumber) => `Su guía de preparación del pedido ${orderNumber}`,
    cta: 'Volver a la tienda',
    footer: 'Recibe este correo porque hizo un pedido en Nubandina Coffee.',
  },
};

// Email clients ignore stylesheets and apply their own tag margins, so each tag carries its own.
const P_OPEN = '<p style="margin:0 0 16px">';
const LIST_STYLE = 'margin:0 0 16px;padding-left:24px';

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
  return `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3">${escapeHtml(guide.name)}</h2>${P_OPEN}${m.ratio}: ${escapeHtml(guide.ratio)}</p><ol style="${LIST_STYLE}">${steps}</ol>`;
}

export function run(input: SelectGuidesInput): GuideEmail {
  const { order, variants, guides } = input;
  const locale = normalizeLocale(order.locale, normalizeLocale(input.default_locale, 'en'));
  const m = messagesFor(MESSAGES, locale);

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
    // eslint-disable-next-line security/detect-object-injection -- own keys only: Object.hasOwn rules out inherited members such as constructor
    const guide = Object.hasOwn(guides, method) ? guides[method] : undefined;
    if (guide !== undefined) methodGuides.set(method, guide);
  }

  const methods = [...methodGuides.keys()];
  const send = order.email !== null && methods.length > 0;

  const productList = `<ul style="${LIST_STYLE}">${knownVariants.map((variant) => productListItem(variant, m)).join('')}</ul>`;
  const guideSections = [...methodGuides.values()].map((guide) => guideSection(guideText(guide, locale), m)).join('');
  const bodyHtml = [
    `${P_OPEN}${m.greeting(order.first_name === null ? null : escapeHtml(order.first_name))}</p>`,
    `${P_OPEN}${m.intro(escapeHtml(order.order_number))}</p>`,
    productList,
    guideSections,
    `${P_OPEN}${m.signOff}</p>`,
  ].join('');
  const url = storeUrl(input.store ?? '', locale);
  const html = brandedEmail({ lang: locale, title: m.subject, bodyHtml, cta: url === null ? null : { label: m.cta, url }, footer: m.footer, preheader: m.preheader(order.order_number) });

  return {
    send,
    locale,
    to: order.email,
    subject: m.subject,
    html,
    methods,
  };
}
