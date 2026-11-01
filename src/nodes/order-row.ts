// Turns a normalized order into the flat row the Orders sheet expects: the timestamp converted to
// Bogota time, the line items joined into one readable string, and free shipping as yes/no text.
// Pure: no I/O, no clock.
import type { NormalizedOrder, OrderLine, OrderRow } from './types.ts';

function formatLine(line: OrderLine): string {
  const name = line.variant_title === null ? line.product_title : `${line.product_title} (${line.variant_title})`;
  return `${name} x ${String(line.quantity)}`;
}

export function run(input: { order: NormalizedOrder }): OrderRow {
  const { order } = input;

  const date = DateTime.fromISO(order.created_at).setZone('America/Bogota').toFormat('yyyy-LL-dd HH:mm');
  const products = order.lines.map(formatLine).join('; ');
  const units = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return {
    date,
    order_number: order.order_number,
    customer: order.customer_name,
    city: order.city,
    products,
    units,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    free_shipping: order.free_shipping ? 'yes' : 'no',
  };
}
