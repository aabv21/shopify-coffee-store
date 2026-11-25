// Adds one unit of a variant to the cart, shared by the coffee finder and the free-shipping bar.
export interface CartAddOptions {
  /** `routes.cart_add_url`, for the Cart AJAX fallback. */
  cartAddUrl: string;
  /** `routes.cart_url`, where the fallback goes after an add that opens the cart. */
  cartUrl: string;
  /** Open the cart drawer (or, in the fallback, the cart page) after a successful add. */
  openCart: boolean;
}

export interface CartAddResult {
  ok: boolean;
  warnings: string[];
}

/** A rejection (a network failure) propagates; a refusal from Shopify comes back as `ok: false`. */
export async function addToCart(variantId: string, o: CartAddOptions): Promise<CartAddResult> {
  const actions = window.Shopify?.actions;
  if (actions) {
    const result = await actions.updateCart(
      { lines: [{ merchandiseId: variantId, quantity: 1 }] },
      { event: { context: 'standard-action' } },
    );
    if (result.userErrors && result.userErrors.length > 0) return { ok: false, warnings: [] };
    if (o.openCart) {
      // The add already succeeded; opening the drawer is best-effort and can't undo that.
      try {
        await actions.openCart();
      } catch (err: unknown) {
        console.warn('cart-add: openCart failed after a successful add', err);
      }
    }
    return { ok: true, warnings: (result.warnings ?? []).map((warning) => warning.message) };
  }

  const response = await fetch(`${o.cartAddUrl}.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
  });
  if (!response.ok) return { ok: false, warnings: [] };
  if (o.openCart) window.location.assign(o.cartUrl);
  return { ok: true, warnings: [] };
}
