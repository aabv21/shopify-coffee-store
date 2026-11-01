// Fixed data contracts shared across Code nodes. Pure types only: no I/O, no clock, no Node
// imports — a later task's Code node compiles against these the same way normalize-order.ts does.

/** The subset of Shopify's `orders/create` webhook payload normalize-order.ts reads. */
export interface ShopifyOrderPayload {
  id?: number | null;
  admin_graphql_api_id?: string;
  name: string;
  created_at: string;
  email?: string | null;
  contact_email?: string | null;
  currency: string;
  subtotal_price: string;
  total_price: string;
  total_shipping_price_set?: { shop_money?: { amount?: string } };
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address?: { first_name?: string | null; name?: string | null; city?: string | null } | null;
  billing_address?: { first_name?: string | null; name?: string | null; city?: string | null } | null;
  shipping_lines?: { title?: string; price?: string }[];
  line_items?: {
    variant_id?: number | string | null;
    title: string;
    variant_title?: string | null;
    sku?: string | null;
    quantity: number;
  }[];
}

export interface OrderLine {
  variant_id: string | null;
  variant_gid: string | null;
  product_title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
}

export interface NormalizedOrder {
  order_id: string;
  order_number: string;
  created_at: string;
  email: string | null;
  first_name: string | null;
  customer_name: string;
  city: string;
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
  free_shipping: boolean;
  lines: OrderLine[];
  variant_gids: string[];
}

export interface OrderRow {
  date: string;
  order_number: string;
  customer: string;
  city: string;
  products: string;
  units: number;
  subtotal: number;
  shipping: number;
  total: number;
  free_shipping: 'yes' | 'no';
}

export interface VariantInfo {
  variant_gid: string;
  product_title: string;
  variant_title: string;
  sku: string | null;
  tracked: boolean;
  available: number;
  roast: string | null;
  brew_method: string | null;
}

export interface LowStockItem {
  product_title: string;
  variant_title: string;
  sku: string | null;
  available: number;
}

export interface StockReport {
  variants: VariantInfo[];
  low_stock: LowStockItem[];
  subject: string;
  text: string;
}

export interface BrewingGuide {
  name: string;
  ratio: string;
  steps: [string, string, string];
}

export type BrewingGuides = Record<string, BrewingGuide>;

export interface GuideEmail {
  send: boolean;
  to: string | null;
  subject: string;
  html: string;
  methods: string[];
}
