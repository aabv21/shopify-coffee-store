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

Both formats round to whole pesos and use a period as the thousands separator (82,000 COP shows as `$82.000`), matching whole-peso pricing (COP has no minor unit in practice).

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

## 8. Admin API access

n8n's Shopify credential needs an Admin API access token. Admin-created custom apps can no longer be created since 2026-01-01, so this app comes from the Dev Dashboard instead.

1. In the [Dev Dashboard](https://dev.shopify.com/dashboard), go to **Apps > Create app > Start from Dev Dashboard**. Name it "Nubandina Orders", with **Custom** distribution for the dev store.
2. Create an app version with:
   - App URL `https://shopify.dev/apps/default-app-home`, not embedded.
   - Scopes `read_orders,read_products,read_inventory`.
   - Redirect URL `https://127.0.0.1/shopify/callback`.
   - Webhooks API version `2026-10`.
3. Install the app from the Installs card.
4. Copy the app's client ID and client secret into `.env` (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`), then run `pnpm run shopify:token`.
5. If n8n can't subscribe to `orders/create` because of protected customer data, request access to name, email, and address under **Protected customer data access** in the Partner Dashboard. Dev stores need no review.

`pnpm run shopify:token` walks through Shopify's authorization code grant: it prints an authorize URL, the owner opens it and approves access, the browser then fails to load the redirect URL on purpose, and the owner pastes that address-bar URL back into the prompt. The script validates it and exchanges the code for an offline token that doesn't expire, then saves it to `SHOPIFY_ACCESS_TOKEN` in `.env`.

If Shopify refuses `https://127.0.0.1/shopify/callback` as a redirect URL, fall back to `pnpm run shopify:token -- --client-credentials`. This only works for a same-organization dev store, and the resulting token expires in 24 hours. Once the store is live, re-run this daily: `pnpm run shopify:token -- --client-credentials`, then `pnpm run setup -- --refresh nbcCredShopify01 --live`. The `--live` flag matters — without it, `pnpm run setup` re-imports every workflow and leaves the Shopify trigger unpublished, taking live order intake offline.

**An existing pre-2026 admin-created custom app** still works without any of the above: put its `shpat_` token directly in `SHOPIFY_ACCESS_TOKEN` and its API secret key in `SHOPIFY_CLIENT_SECRET`.

## 9. Create the Orders sheet

The core order workflow (`process-order`) logs every order to a Google Sheet, not to Shopify. Create it once, in the same Google account n8n signs in with for the Sheets and Gmail credentials:

1. Create a new Google Sheet and rename its first tab to match `config.google.orders_tab` exactly (`Orders` in `config/config.example.json`).
2. Give that tab a header row with these column names, in order:

   `date | order_number | customer | city | products | units | subtotal | shipping | total | free_shipping`

3. Copy the sheet's id (the long value between `/d/` and `/edit` in its URL) into `config.google.orders_sheet_id`.

`process-order`'s "Upsert order row" node finds the tab by this name and matches column data to the header row automatically; a missing or renamed header column breaks the write instead of silently landing a value elsewhere.

## 10. Add Spanish

The theme and the emails already speak Spanish; the store needs it published as a second language:

1. In the admin, go to **Settings > Languages**, add **Spanish**, and publish it. The storefront then serves it under `/es`, and the theme's own strings come from `locales/es.json`.
2. Install Shopify's **Translate & Adapt** app and translate each product's title, tasting notes, and image alt text. These are store data, not theme text, so the theme can't translate them.
3. Leave the coffee finder's and the free-shipping bar's text settings blank unless the store wants one wording in every language: a blank setting shows each visitor the translated default, and a filled one overrides it everywhere.

An order placed in Spanish carries `customer_locale` `es`, so its brewing guide goes out in Spanish. The owner's emails follow `team_locale` in `config/config.json`.
