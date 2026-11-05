import { normalizeLocale, type Locale } from '../lib/locale.ts';
import type { LowStockItem, NormalizedOrder, StockReport, VariantInfo } from './types.ts';

interface GraphQlError {
  message: string;
}

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number;
  inventoryItem: { tracked: boolean };
  product: {
    title: string;
    roast: { value: string } | null;
    brewMethod: { value: string } | null;
  };
}

interface StockResponse {
  errors?: GraphQlError[];
  data?: { nodes: (VariantNode | null)[] };
}

export interface SelectLowStockInput {
  order: NormalizedOrder;
  response: unknown;
  threshold: number;
  /** `config.team_locale`, as the workflow reads it: blank or missing means English. */
  team_locale?: string;
}

interface Messages {
  subject: (orderNumber: string) => string;
  line: (item: LowStockItem, threshold: number) => string;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: (orderNumber) => `Low stock after order ${orderNumber}`,
    line: (item, threshold) => `${item.product_title} (${item.variant_title}), SKU ${item.sku ?? ''}: ${String(item.available)} left (threshold ${String(threshold)})`,
  },
  es: {
    subject: (orderNumber) => `Inventario bajo tras el pedido ${orderNumber}`,
    line: (item, threshold) => `${item.product_title} (${item.variant_title}), SKU ${item.sku ?? ''}: quedan ${String(item.available)} (umbral ${String(threshold)})`,
  },
};

function toVariantInfo(gid: string, node: VariantNode): VariantInfo {
  return {
    variant_gid: gid,
    product_title: node.product.title,
    variant_title: node.title,
    sku: node.sku,
    tracked: node.inventoryItem.tracked,
    available: node.inventoryQuantity,
    roast: node.product.roast?.value ?? null,
    brew_method: node.product.brewMethod?.value ?? null,
  };
}

function toLowStockItem(variant: VariantInfo): LowStockItem {
  return { product_title: variant.product_title, variant_title: variant.variant_title, sku: variant.sku, available: variant.available };
}

export function run(input: SelectLowStockInput): StockReport {
  const response = input.response as StockResponse;

  if (response.errors && response.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${response.errors.map((e) => e.message).join('; ')}`);
  }

  const nodes = response.data?.nodes;
  if (!Array.isArray(nodes)) throw new Error('Shopify GraphQL response has no nodes');

  const byGid = new Map<string, VariantNode>();
  for (const node of nodes) {
    if (node !== null) byGid.set(node.id, node);
  }

  const variants: VariantInfo[] = [];
  for (const gid of input.order.variant_gids) {
    const node = byGid.get(gid);
    if (node) variants.push(toVariantInfo(gid, node));
  }

  const lowStock = variants.filter((v) => v.tracked && v.available < input.threshold).map(toLowStockItem);
  const m = MESSAGES[normalizeLocale(input.team_locale, 'en')];

  return {
    variants,
    low_stock: lowStock,
    subject: m.subject(input.order.order_number),
    text: lowStock.map((item) => m.line(item, input.threshold)).join('\n'),
  };
}
