// Validates the config just loaded from /files/config/config.json. Pure: no I/O, no clock, no
// Node imports — a later task bundles this into an n8n Code node.

export interface Config {
  owner_email: string;
  google: {
    orders_sheet_id: string;
    orders_tab: string;
  };
  shopify: {
    store: string;
    api_version: string;
  };
  low_stock_threshold: number;
  guide_delay_minutes: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHOPIFY_STORE_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHOPIFY_API_VERSION_RE = /^\d{4}-(01|04|07|10)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireNonEmptyString(path: string, value: unknown): void {
  if (typeof value !== 'string' || value === '') throw new Error(`${path} must be a non-empty string`);
}

function requireIntegerAtLeast(path: string, value: unknown, min: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`${path} must be an integer >= ${String(min)}`);
  }
}

/** Validates every config value a downstream node depends on, and throws a clear `Error` naming the first bad key it finds. */
export function validateConfig(value: unknown): Config {
  const root = asObject(value, 'config');

  if (typeof root.owner_email !== 'string' || !EMAIL_RE.test(root.owner_email)) {
    throw new Error('owner_email must be an email address');
  }

  const google = asObject(root.google, 'config.google');
  requireNonEmptyString('google.orders_sheet_id', google.orders_sheet_id);
  requireNonEmptyString('google.orders_tab', google.orders_tab);

  const shopify = asObject(root.shopify, 'config.shopify');
  if (typeof shopify.store !== 'string' || !SHOPIFY_STORE_RE.test(shopify.store)) {
    throw new Error('shopify.store must be the store subdomain');
  }
  if (typeof shopify.api_version !== 'string' || !SHOPIFY_API_VERSION_RE.test(shopify.api_version)) {
    throw new Error('shopify.api_version must look like 2026-10');
  }

  requireIntegerAtLeast('low_stock_threshold', root.low_stock_threshold, 1);
  requireIntegerAtLeast('guide_delay_minutes', root.guide_delay_minutes, 2);

  return value as Config;
}
