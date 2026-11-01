# Shopify dev store setup

Step-by-step guide for the owner to create and configure the Nubandina Coffee development store. This is a manual, one-time setup; none of it runs from this repo's tooling.

## 1. Create the dev store

1. Sign in to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) with the Partner organization.
2. Create a new development store.
3. Set store language to English, currency to COP (Colombian peso), and the store address to Colombia.
4. Set the store's time zone to `America/Bogota`.

## 2. Set the currency format

In **Settings > General > Store currency**, set the customer-facing currency formatting:

- **HTML without currency:** `${{amount_no_decimals_with_comma_separator}}`
- **HTML with currency:** `${{amount_no_decimals_with_comma_separator}} COP`

Both formats omit decimals and use a comma as the thousands separator, matching whole-peso pricing (COP has no minor unit in practice).

## 3. Create the metafield definitions

Create these **before** importing the product CSV — a metafield column in the import only fills a definition that already exists.

Go to **Settings > Custom data > Products > Add definition**, and create one text definition per row, each with namespace `coffee`:

| Key | Name | Type | Validation |
|---|---|---|---|
| `roast` | Roast | Single line text | Choices: `light`, `medium`, `dark` |
| `tasting_notes` | Tasting notes | Single line text | None |
| `brew_method` | Brew method | Single line text | Choices: `pour-over`, `espresso`, `french-press` |

For `roast` and `brew_method`, add each choice under **Validation > Choices** so the admin UI offers a dropdown instead of free text.

## 4. Import the product catalog

1. Go to **Products > Import**.
2. Upload `data/products.csv` from this repo.
3. Confirm the preview shows 3 products and 6 variants, then start the import.
4. After the import finishes, open each product and confirm its `Roast`, `Tasting notes`, and `Brew method` metafields are filled, and that its image is attached.

**Note:** the CSV's "Inventory quantity" column only applies to stores with a single location — it sets the starting stock at that location. A multi-location store would need to set stock per location after import instead.

## 5. Set shipping rates

In **Settings > Shipping and delivery**, edit the rates for the Colombia shipping zone:

| Rate name | Price | Condition |
|---|---|---|
| Standard shipping | 12,000 COP | Order subtotal 0–119,999 COP |
| Free shipping | 0 COP | Order subtotal from 120,000 COP |

The theme's free-shipping threshold setting (`free_shipping_threshold`, under **Online Store > Themes > Customize > Theme settings > Free shipping bar**) must equal the free rate's minimum: **120,000 COP**. A mismatch would show the storefront's free-shipping bar reaching its goal at a different amount than checkout actually charges free shipping.

## 6. Enable the Bogus Gateway

For placing test orders without a real payment provider:

1. Go to **Settings > Payments**.
2. Under **Manual payment methods**, or the payment provider search, enable **Bogus Gateway** (Shopify's built-in test gateway for development stores).
3. Confirm it appears as an active payment method at checkout on this store.

## 7. Product images and credits

Each product uses one photo from [Burst](https://www.shopify.com/stock-photos), Shopify's free stock photo site. Every page and image URL below was checked to return HTTP 200 over HTTPS.

| Product | Page URL | Image URL | Credit | License |
|---|---|---|---|---|
| Nariño | <https://www.shopify.com/stock-photos/photos/barista-pour-over-coffee-from-copper-kettle> | <https://burst.shopifycdn.com/photos/barista-pour-over-coffee-from-copper-kettle.jpg> | Photo by Brodie (`@thenomadbrodie`) | [Burst Some Rights Reserved](https://www.shopify.com/stock-photos/licenses/shopify-some-rights-reserved) — free for commercial use, attribution optional but encouraged |
| Huila | <https://www.shopify.com/stock-photos/photos/coffee-beans-from-above> | <https://burst.shopifycdn.com/photos/coffee-beans-from-above.jpg> | Photo by Matthew Henry | [Creative Commons Zero](https://www.shopify.com/stock-photos/licenses/creative-commons) (CC0) — free for commercial use, no attribution required |
| Sierra Nevada | <https://www.shopify.com/stock-photos/photos/long-espresso-sits-on-a-wooden-stool> | <https://burst.shopifycdn.com/photos/long-espresso-sits-on-a-wooden-stool.jpg> | Photo by Brodie (`@thenomadbrodie`) | [Burst Some Rights Reserved](https://www.shopify.com/stock-photos/licenses/shopify-some-rights-reserved) — free for commercial use, attribution optional but encouraged |

Both licenses permit commercial use without attribution; the photographer credit above is recorded because each photo's page states it, not because the license requires it.
