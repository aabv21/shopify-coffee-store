// Builds the owner's plain-text order summary in the team's language, from the same row the
// Orders sheet gets. Amounts use the locale's own digit grouping. Pure: no I/O, no clock.
import { normalizeLocale, type Locale } from '../lib/locale.ts';
import type { OrderRow } from './types.ts';

export interface OwnerSummaryInput {
  row: OrderRow;
  /** `config.team_locale`, as the workflow reads it: blank or missing means English. */
  team_locale?: string;
}

export interface OwnerSummary {
  subject: string;
  text: string;
}

interface Messages {
  numberLocale: string;
  subject: (orderNumber: string, total: string) => string;
  labels: Record<'order' | 'date' | 'customer' | 'city' | 'products' | 'units' | 'subtotal' | 'shipping' | 'total' | 'freeShipping', string>;
  yes: string;
  no: string;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    numberLocale: 'en-US',
    subject: (orderNumber, total) => `New order ${orderNumber}: ${total} COP`,
    labels: {
      order: 'Order',
      date: 'Date',
      customer: 'Customer',
      city: 'City',
      products: 'Products',
      units: 'Units',
      subtotal: 'Subtotal',
      shipping: 'Shipping',
      total: 'Total',
      freeShipping: 'Free shipping',
    },
    yes: 'yes',
    no: 'no',
  },
  es: {
    numberLocale: 'es-CO',
    subject: (orderNumber, total) => `Nuevo pedido ${orderNumber}: ${total} COP`,
    labels: {
      order: 'Pedido',
      date: 'Fecha',
      customer: 'Cliente',
      city: 'Ciudad',
      products: 'Productos',
      units: 'Unidades',
      subtotal: 'Subtotal',
      shipping: 'Envío',
      total: 'Total',
      freeShipping: 'Envío gratis',
    },
    yes: 'sí',
    no: 'no',
  },
};

export function run(input: OwnerSummaryInput): OwnerSummary {
  const { row } = input;
  const m = MESSAGES[normalizeLocale(input.team_locale, 'en')];
  const amount = (value: number): string => `${value.toLocaleString(m.numberLocale)} COP`;
  const { labels } = m;

  const lines: [string, string][] = [
    [labels.order, row.order_number],
    [labels.date, row.date],
    [labels.customer, row.customer],
    [labels.city, row.city],
    [labels.products, row.products],
    [labels.units, String(row.units)],
    [labels.subtotal, amount(row.subtotal)],
    [labels.shipping, amount(row.shipping)],
    [labels.total, amount(row.total)],
    [labels.freeShipping, row.free_shipping === 'yes' ? m.yes : m.no],
  ];

  return {
    subject: m.subject(row.order_number, row.total.toLocaleString(m.numberLocale)),
    text: lines.map(([label, value]) => `${label}: ${value}`).join('\n'),
  };
}
