// The mock catalog the offline preview renders: products.csv shaped like Shopify's Liquid objects.
import { parse } from 'csv-parse/sync';

export interface MockVariant { id: number; title: string; weight: number; available: boolean; price: number }
export interface MockImage { src: string; alt: string }
interface MockMetafield { value: string | null }
export interface MockProduct {
  id: number;
  handle: string;
  title: string;
  url: string;
  featured_image: MockImage | null;
  metafields: { coffee: { roast: MockMetafield; tasting_notes: MockMetafield; brew_method: MockMetafield } };
  variants: MockVariant[];
}

const COLUMN = {
  title: 'Title',
  handle: 'URL handle',
  status: 'Status',
  option: 'Option1 value',
  price: 'Price',
  quantity: 'Inventory quantity',
  policy: 'Continue selling when out of stock',
  grams: 'Weight value (grams)',
  image: 'Product image URL',
  alt: 'Image alt text',
  roast: 'Roast (product.metafields.coffee.roast)',
  notes: 'Tasting notes (product.metafields.coffee.tasting_notes)',
  method: 'Brew method (product.metafields.coffee.brew_method)',
} as const;

// Synthetic ids, in distinct ranges so a product id can't pass for a variant id.
const FIRST_PRODUCT_ID = 1001;
const FIRST_VARIANT_ID = 2001;

function cell(row: Record<string, string>, column: string): string {
  // eslint-disable-next-line security/detect-object-injection -- column is one of COLUMN's fixed header names
  return row[column]?.trim() ?? '';
}

function metafield(value: string): MockMetafield {
  return { value: value === '' ? null : value };
}

function wholeNumber(value: string, what: string): number {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new Error(`products.csv: ${what} is not a number: "${value}"`);
  return n;
}

/**
 * One product per `URL handle` (its first row carries the title, image, and metafields), one
 * variant per row, prices in cents. A variant is available when it has stock or keeps selling
 * without it, and only `Active` products are listed, as on a storefront.
 */
export function parseCatalog(csv: string): MockProduct[] {
  const rows = parse<Record<string, string>>(csv, { columns: true, bom: true, skip_empty_lines: true });
  const byHandle = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const handle = cell(row, COLUMN.handle);
    if (handle === '') throw new Error('products.csv: a row has no URL handle');
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), row]);
  }

  const products: MockProduct[] = [];
  let productId = FIRST_PRODUCT_ID;
  let variantId = FIRST_VARIANT_ID;
  for (const [handle, group] of byHandle) {
    const [first] = group;
    if (!first || cell(first, COLUMN.title) === '') throw new Error(`products.csv: ${handle}'s first row has no Title`);
    const id = productId++;
    const variants = group.map((row) => ({
      id: variantId++,
      title: cell(row, COLUMN.option),
      weight: wholeNumber(cell(row, COLUMN.grams), `${handle} weight`),
      available: wholeNumber(cell(row, COLUMN.quantity), `${handle} inventory`) > 0 || cell(row, COLUMN.policy) === 'CONTINUE',
      price: Math.round(wholeNumber(cell(row, COLUMN.price), `${handle} price`) * 100),
    }));
    if (cell(first, COLUMN.status) !== 'Active') continue;

    const image = cell(first, COLUMN.image);
    products.push({
      id,
      handle,
      title: cell(first, COLUMN.title),
      url: `/products/${handle}`,
      featured_image: image === '' ? null : { src: image, alt: cell(first, COLUMN.alt) },
      metafields: {
        coffee: {
          roast: metafield(cell(first, COLUMN.roast)),
          tasting_notes: metafield(cell(first, COLUMN.notes)),
          brew_method: metafield(cell(first, COLUMN.method)),
        },
      },
      variants,
    });
  }
  return products;
}
