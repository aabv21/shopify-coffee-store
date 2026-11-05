import { normalizeLocale } from '../lib/locale.ts';
import type { NormalizedOrder, OrderLine, ShopifyOrderPayload } from './types.ts';

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

/** Null, missing, or `''` means Shopify sent no amount, not an amount of 0. */
function isMissingAmount(value: string | number | undefined | null): boolean {
  return value === null || value === undefined || value === '';
}

function toNumber(value: string | number | undefined | null): number {
  if (isMissingAmount(value)) throw new Error('Order payload has an invalid amount');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Order payload has an invalid amount');
  return n;
}

function readShippingAmount(order: ShopifyOrderPayload): number {
  const fromSet = order.total_shipping_price_set?.shop_money?.amount;
  if (!isMissingAmount(fromSet)) return toNumber(fromSet);

  const lines = order.shipping_lines ?? [];
  if (lines.length === 0) return 0;

  let sum = 0;
  for (const line of lines) sum += toNumber(line.price);
  return sum;
}

function variantGid(variantId: number | string | null | undefined): string | null {
  if (variantId === null || variantId === undefined || variantId === '') return null;
  return `gid://shopify/ProductVariant/${String(variantId)}`;
}

function normalizeLine(item: NonNullable<ShopifyOrderPayload['line_items']>[number]): OrderLine {
  const title = item.variant_title ?? '';
  return {
    variant_id: item.variant_id === null || item.variant_id === undefined || item.variant_id === '' ? null : String(item.variant_id),
    variant_gid: variantGid(item.variant_id),
    product_title: item.title,
    variant_title: title === '' || title === 'Default Title' ? null : title,
    sku: item.sku ?? null,
    quantity: item.quantity,
  };
}

export function run(order: ShopifyOrderPayload): NormalizedOrder {
  const orderId = order.admin_graphql_api_id
    ? order.admin_graphql_api_id.replace('gid://shopify/Order/', '')
    : (order.id == null ? '' : String(order.id));
  if (!orderId) throw new Error('Order payload has no id');

  if (!order.name) throw new Error('Order payload has no order number');

  if (!order.line_items || order.line_items.length === 0) throw new Error('Order payload has no line items');

  const emailRaw = (order.email || order.contact_email || '').trim();
  // A comma, whitespace, `;`, `<` or `>` could add a recipient or inject a header in Gmail's "To",
  // so such an address counts as none.
  const email = emailRaw === '' || /[,;<>\s]/.test(emailRaw) ? null : emailRaw;

  const firstName = firstNonEmpty(order.customer?.first_name, order.shipping_address?.first_name, order.billing_address?.first_name);

  const customerFullName = `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim();
  const customerName = firstNonEmpty(order.shipping_address?.name, order.billing_address?.name, customerFullName === '' ? null : customerFullName) ?? '';

  const city = firstNonEmpty(order.shipping_address?.city, order.billing_address?.city) ?? '';

  const subtotal = toNumber(order.subtotal_price);
  const shipping = readShippingAmount(order);
  const total = toNumber(order.total_price);

  const freeShipping = (order.shipping_lines ?? []).length > 0 && shipping === 0;

  const lines = order.line_items.map(normalizeLine);

  const variantGids: string[] = [];
  for (const line of lines) {
    if (line.variant_gid !== null && !variantGids.includes(line.variant_gid)) variantGids.push(line.variant_gid);
  }

  return {
    order_id: orderId,
    order_number: order.name,
    created_at: order.created_at,
    email,
    first_name: firstName,
    customer_name: customerName,
    city,
    locale: normalizeLocale(order.customer_locale, null),
    currency: order.currency,
    subtotal,
    shipping,
    total,
    free_shipping: freeShipping,
    lines,
    variant_gids: variantGids,
  };
}
