// Ambient types for the platform-provided Shopify.actions API (content_for_header), declaring
// only the members this theme calls.

export interface UpdateCartResult {
  userErrors?: { message: string }[];
  warnings?: { message: string }[];
}

declare global {
  interface Window {
    Shopify?: {
      actions?: {
        updateCart: (
          payload: { lines: { merchandiseId: string; quantity: number }[] },
          options?: { event?: { context?: 'standard-action' } },
        ) => Promise<UpdateCartResult>;
        openCart: () => Promise<void>;
      };
    };
  }
}
