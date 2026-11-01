// Builds the brewing-guide email: one guide per brew method found among the order's known
// variants, plus a list of the coffees bought. Pure: no I/O, no clock.
import type { BrewingGuide, BrewingGuides, GuideEmail, NormalizedOrder, VariantInfo } from './types.ts';

export interface SelectGuidesInput {
  order: NormalizedOrder;
  variants: VariantInfo[];
  guides: BrewingGuides;
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value: string): string {
  // eslint-disable-next-line security/detect-object-injection -- char is always one of ESCAPE_RE's own fixed characters
  return value.replace(ESCAPE_RE, (char) => ESCAPES[char] ?? char);
}

function greeting(firstName: string | null): string {
  return `<p>Hi ${escapeHtml(firstName ?? 'there')},</p>`;
}

function intro(orderNumber: string): string {
  return `<p>Thanks for your order ${escapeHtml(orderNumber)}. Here's how to get the best from your coffee.</p>`;
}

function productListItem(variant: VariantInfo): string {
  const roastSuffix = variant.roast === null ? '' : `, ${escapeHtml(variant.roast)} roast`;
  return `<li>${escapeHtml(variant.product_title)} (${escapeHtml(variant.variant_title)})${roastSuffix}</li>`;
}

function guideSection(method: string, guide: BrewingGuide): string {
  const steps = guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
  return `<h2>${escapeHtml(guide.name)}</h2><p>Ratio: ${escapeHtml(guide.ratio)}</p><ol>${steps}</ol>`;
}

export function run(input: SelectGuidesInput): GuideEmail {
  const { order, variants, guides } = input;

  const byGid = new Map<string, VariantInfo>();
  for (const variant of variants) byGid.set(variant.variant_gid, variant);

  const knownVariants: VariantInfo[] = [];
  const methodGuides = new Map<string, BrewingGuide>();
  for (const line of order.lines) {
    if (line.variant_gid === null) continue;
    const variant = byGid.get(line.variant_gid);
    if (!variant) continue;
    knownVariants.push(variant);
    const method = variant.brew_method;
    if (method === null || methodGuides.has(method)) continue;
    // eslint-disable-next-line security/detect-object-injection -- method is a brew method read from Shopify product metadata, used only to look up a locally defined guide
    const guide = guides[method];
    if (guide !== undefined) methodGuides.set(method, guide);
  }

  const methods = [...methodGuides.keys()];
  const send = order.email !== null && methods.length > 0;

  const productList = `<ul>${knownVariants.map(productListItem).join('')}</ul>`;
  const guideSections = [...methodGuides.entries()].map(([method, guide]) => guideSection(method, guide)).join('');
  const html = [
    greeting(order.first_name),
    intro(order.order_number),
    productList,
    guideSections,
    '<p>Enjoy your coffee,<br>Nubandina Coffee</p>',
  ].join('');

  return {
    send,
    to: order.email,
    subject: 'How to brew your Nubandina coffee',
    html,
    methods,
  };
}
