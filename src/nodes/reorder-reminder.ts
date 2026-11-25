import { messagesFor, normalizeLocale, type Locale } from '../lib/locale.ts';
import { brandedEmail, escapeHtml, storeUrl } from './email-shell.ts';
import type { NormalizedOrder, VariantInfo } from './types.ts';

export interface ReorderReminderInput {
  order: NormalizedOrder;
  variants: VariantInfo[];
  /** `recorded` is false once the order's row is gone, as after an erasure request. */
  status: { cancelled: boolean; reordered: boolean; recorded: boolean };
  /** `config.shopify.store`: blank or an invalid subdomain means no cart link, so no reminder. */
  store: string;
  days: number;
  /** `config.default_locale`, as the workflow reads it: blank or missing means English. */
  default_locale?: string;
}

export type ReminderReason = 'sent' | 'no_consent' | 'no_customer' | 'no_email' | 'not_recorded' | 'cancelled' | 'reordered' | 'no_known_variant';

export interface ReorderReminder {
  send: boolean;
  reason: ReminderReason;
  to: string | null;
  subject: string;
  html: string;
}

// Every argument a message receives is already HTML-escaped.
interface Messages {
  subject: string;
  greeting: (firstName: string | null) => string;
  intro: (days: number, orderNumber: string) => string;
  cta: string;
  footer: string;
  preheader: string;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: 'Time to restock your coffee?',
    greeting: (firstName) => `Hi ${firstName ?? 'there'},`,
    intro: (days, orderNumber) =>
      `It's been ${days === 1 ? 'a day' : `about ${String(days)} days`} since your order ${orderNumber}. If your coffee is running low, you can reorder the same bags in one click:`,
    cta: 'Reorder the same bags',
    footer: "You're getting this email because you agreed to marketing emails at checkout. Don't want these? Reply to this email and we'll stop.",
    preheader: 'Reorder the same bags in one click',
  },
  es: {
    subject: '¿Es hora de reponer su café?',
    greeting: (firstName) => (firstName === null ? 'Hola:' : `Hola, ${firstName}:`),
    intro: (days, orderNumber) =>
      `${days === 1 ? 'Ha pasado un día' : `Han pasado unos ${String(days)} días`} desde su pedido ${orderNumber}. Si su café se está acabando, puede volver a pedir las mismas bolsas con un clic:`,
    cta: 'Volver a pedir lo mismo',
    footer: 'Le enviamos este correo porque al pagar aceptó recibir nuestras novedades. ¿No desea recibirlos? Responda a este correo y no le enviaremos más.',
    preheader: 'Vuelva a pedir las mismas bolsas con un clic',
  },
};

const P_OPEN = '<p style="margin:0 0 16px">';
const LIST_STYLE = 'margin:0 0 16px;padding-left:24px';

function skipped(reason: ReminderReason): ReorderReminder {
  return { send: false, reason, to: null, subject: '', html: '' };
}

/**
 * Decides, in one place, whether the reminder goes out and renders it. The reasons are checked in
 * order: consent as the order recorded it at checkout, a customer id (a guest can't be checked for
 * a reorder), an email address, the order still being recorded, a cancellation, a reorder, then a
 * bag from the order-time stock read.
 */
export function run(input: ReorderReminderInput): ReorderReminder {
  const { order, variants, status } = input;
  // Only an explicit true counts: a waiting order from before the field existed, or a null, has no consent.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- the value crosses n8n's JSON and can be missing or a string
  if (order.accepts_marketing !== true) return skipped('no_consent');
  // A guest order never matches another, so nothing could tell this reminder the customer reordered.
  if (order.customer_id == null) return skipped('no_customer');
  if (order.email === null) return skipped('no_email');
  if (!status.recorded) return skipped('not_recorded');
  if (status.cancelled) return skipped('cancelled');
  if (status.reordered) return skipped('reordered');

  const locale = normalizeLocale(order.locale, normalizeLocale(input.default_locale, 'en'));
  const m = messagesFor(MESSAGES, locale);

  const byGid = new Map<string, VariantInfo>();
  for (const variant of variants) byGid.set(variant.variant_gid, variant);
  const known = order.lines.flatMap((line) => {
    const variant = line.variant_gid === null ? undefined : byGid.get(line.variant_gid);
    return variant === undefined || line.variant_id === null ? [] : [{ line, variant }];
  });
  const base = storeUrl(input.store, 'en');
  if (known.length === 0 || base === null) return skipped('no_known_variant');

  const cartUrl = `${base}cart/${known.map(({ line }) => `${line.variant_id ?? ''}:${String(line.quantity)}`).join(',')}`;
  const items = known
    .map(({ line, variant }) => `<li>${escapeHtml(variant.product_title)} (${escapeHtml(variant.variant_title)}) × ${String(line.quantity)}</li>`)
    .join('');
  const bodyHtml = [
    `${P_OPEN}${m.greeting(order.first_name === null ? null : escapeHtml(order.first_name))}</p>`,
    `${P_OPEN}${m.intro(input.days, escapeHtml(order.order_number))}</p>`,
    `<ul style="${LIST_STYLE}">${items}</ul>`,
  ].join('');

  return {
    send: true,
    reason: 'sent',
    to: order.email,
    subject: m.subject,
    html: brandedEmail({ lang: locale, title: m.subject, bodyHtml, cta: { label: m.cta, url: cartUrl }, footer: m.footer, preheader: m.preheader }),
  };
}
