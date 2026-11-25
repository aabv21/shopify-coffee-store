// Never throws: a bad time or an unknown reason still produces a notice for the owner.
import { messagesFor, STORE_TIMEZONE, type Locale } from '../lib/locale.ts';

export interface CancelNoticeInput {
  cancellation: { order_number: string; cancelled_at: string; cancel_reason: string };
  team_locale?: string;
}

export interface CancelNotice {
  subject: string;
  text: string;
}

interface Messages {
  subject: (n: string) => string;
  line1: (n: string) => string;
  reason: string;
  cancelledAt: string;
  line4: string;
  notGiven: string;
  unknown: string;
  reasons: Record<string, string>;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: (n) => `Order ${n} cancelled`,
    line1: (n) => `Order ${n} was cancelled in Shopify.`,
    reason: 'Reason',
    cancelledAt: 'Cancelled at',
    line4: 'Its Orders row now reads "cancelled". No brewing guide or reorder reminder goes out for it from now on.',
    notGiven: 'not given',
    unknown: 'unknown',
    reasons: { customer: 'customer request', fraud: 'fraud', inventory: 'out of stock', declined: 'payment declined', staff: 'staff error', other: 'other' },
  },
  es: {
    subject: (n) => `Pedido ${n} cancelado`,
    line1: (n) => `El pedido ${n} se canceló en Shopify.`,
    reason: 'Motivo',
    cancelledAt: 'Cancelado el',
    line4: 'Su fila en Orders ahora dice "cancelled". A partir de ahora no se enviará la guía de preparación ni el recordatorio de recompra.',
    notGiven: 'no indicado',
    unknown: 'desconocida',
    reasons: { customer: 'solicitud del cliente', fraud: 'fraude', inventory: 'sin inventario', declined: 'pago rechazado', staff: 'error del personal', other: 'otro' },
  },
};

export function run(input: CancelNoticeInput): CancelNotice {
  const m = messagesFor(MESSAGES, input.team_locale);
  const { cancellation } = input;
  const number = cancellation.order_number.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const reasonKey = cancellation.cancel_reason.trim();
  const reason = reasonKey === '' ? m.notGiven : (new Map(Object.entries(m.reasons)).get(reasonKey) ?? reasonKey);
  const parsed = DateTime.fromISO(cancellation.cancelled_at);
  const time = parsed.isValid ? parsed.setZone(STORE_TIMEZONE).toFormat('yyyy-LL-dd HH:mm') : m.unknown;

  return {
    subject: m.subject(number),
    text: [m.line1(number), `${m.reason}: ${reason}`, `${m.cancelledAt}: ${time} ${STORE_TIMEZONE}`, m.line4].join('\n'),
  };
}
