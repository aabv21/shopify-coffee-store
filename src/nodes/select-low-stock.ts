// Turns the GraphQL stock read into the report "Any low stock?" and "Email low-stock alert" use:
// one VariantInfo per ordered variant Shopify still has, and the subset that fell below the
// configured threshold. Pure: no I/O, no clock.
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
}

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

function formatLine(item: LowStockItem, threshold: number): string {
  return `${item.product_title} (${item.variant_title}), SKU ${item.sku ?? ''}: ${String(item.available)} left (threshold ${String(threshold)})`;
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

  return {
    variants,
    low_stock: lowStock,
    subject: `Low stock after order ${input.order.order_number}`,
    text: lowStock.map((item) => formatLine(item, input.threshold)).join('\n'),
  };
}
