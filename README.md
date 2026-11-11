# Nubandina Coffee

**Demo**

A Shopify coffee store with a self-hosted n8n order backend, in English and Spanish. The backend handles each order once. It logs a Google Sheets row, emails the owner, alerts on low stock, and later emails the customer a brewing guide in the customer's language. It's built with a strict TypeScript toolchain and runs locally in Docker.

**Video:** coming soon — a 90-second walkthrough of the store, a test order, and the emails it sends.

![System architecture: the storefront sends checkouts to Shopify; the orders/create webhook reaches n8n through an ngrok tunnel; n8n records each order once in Postgres, writes a Google Sheets row, reads stock from Shopify, and emails the owner and the customer through Gmail](docs/diagrams/architecture.svg)

How it works, how it fails, and why it's built this way: [docs/architecture.md](docs/architecture.md). For the full-size, interactive diagram, open [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) from a local clone in a browser.

## What it does

**Storefront** — Shopify's Horizon theme plus this repo's overlay ([`theme/README.md`](theme/README.md)):

- A **coffee finder** on the home page asks three questions (brew method, taste, party size) and recommends one or two coffees in the right bag size, with an "Add to cart" button on each.
- A **free-shipping bar** in the cart shows how far the cart is from free shipping (120,000 COP), rendered on the server and updated live as the cart changes.
- **English and Spanish.** Every string the theme adds has a translation, and a merchant's own text in the theme editor overrides it.
- **The Nubandina brand**, set in Horizon's own settings: a coffee palette held to WCAG AA and the Alegreya fonts.

**Order backend** — n8n workflows behind Shopify's `orders/create` webhook ([`docs/architecture.md`](docs/architecture.md)):

- Records **each order once** in Postgres before any side effect, so a repeated delivery does nothing.
- Writes one **Google Sheets row** per order and emails the **owner** a summary.
- Reads stock from Shopify and emails a **low-stock alert** for each tracked variant left under the threshold.
- **Waits** in Postgres (60 minutes by default, surviving a restart), then emails the customer a **brewing guide** for each brew method in the order, in the customer's language.
- Emails the owner an **error alert** with the failed node and an execution link when any step fails.

![The coffee finder's recommendations on a laptop: two coffee cards with photos, notes, prices, and Add to cart buttons beside the three answered questions](docs/screenshots/finder-results-1280.png)

<details>
<summary>All storefront screenshots (offline preview, 390 × 844 and 1280 × 800)</summary>

| | 390 × 844 | 1280 × 800 |
| --- | --- | --- |
| Coffee finder | ![The coffee finder's three questions on a phone](docs/screenshots/finder-empty-390.png) | ![The coffee finder's three questions on a laptop](docs/screenshots/finder-empty-1280.png) |
| Finder results | ![Two recommended coffees on a phone](docs/screenshots/finder-results-390.png) | ![Two recommended coffees on a laptop](docs/screenshots/finder-results-1280.png) |
| Cart at 0% | ![The free-shipping bar, empty, on a phone](docs/screenshots/cart-0-390.png) | ![The free-shipping bar, empty, on a laptop](docs/screenshots/cart-0-1280.png) |
| Cart at 60% | ![The free-shipping bar at 60% on a phone](docs/screenshots/cart-60-390.png) | ![The free-shipping bar at 60% on a laptop](docs/screenshots/cart-60-1280.png) |
| Cart at 100% | ![The free-shipping bar, complete, on a phone](docs/screenshots/cart-100-390.png) | ![The free-shipping bar, complete, on a laptop](docs/screenshots/cart-100-1280.png) |
| Coffee finder, Spanish | ![The coffee finder's three questions in Spanish on a phone](docs/screenshots/finder-empty-es-390.png) | ![The coffee finder's three questions in Spanish on a laptop](docs/screenshots/finder-empty-es-1280.png) |
| Finder results, Spanish | ![Two recommended coffees with Spanish labels on a phone](docs/screenshots/finder-results-es-390.png) | ![Two recommended coffees with Spanish labels on a laptop](docs/screenshots/finder-results-es-1280.png) |
| Cart at 60%, Spanish | ![The free-shipping bar at 60% in Spanish on a phone](docs/screenshots/cart-60-es-390.png) | ![The free-shipping bar at 60% in Spanish on a laptop](docs/screenshots/cart-60-es-1280.png) |

</details>

## Quick start

**Offline**, with no third-party account:

```sh
pnpm install --frozen-lockfile
node scripts/init-env.ts && cp config/config.example.json config/config.json   # fresh local secrets; third-party values stay blank
docker compose ls                                                              # every demo in this series binds 127.0.0.1:5678
docker compose up -d --wait
pnpm run setup
```

n8n is then at <http://localhost:5678>, with every workflow published except the live Shopify trigger.

**Live**, after filling in Configuration below:

1. `docker compose --profile tunnel up -d --wait`
2. `pnpm run shopify:token`
3. `pnpm run setup -- --live`
4. `pnpm run theme:assemble`
5. `pnpm dlx @shopify/cli@5.0.0 theme push --unpublished --theme "Nubandina demo" --path .theme-build/theme --store <store>.myshopify.com`

Already running a local stack from before `db/migrations/` or `app_runtime` existed? Follow `docs/database.md`'s "Upgrading an existing local stack" instead of starting over. It includes the one-time `pnpm run setup -- --refresh nbcCredAppDb0001` the `App DB` credential needs on an existing volume.

## Configuration

`node scripts/init-env.ts` fills the local secrets (the Postgres roles, `N8N_ENCRYPTION_KEY`, `DEV_HARNESS_TOKEN`). Everything else comes from an account you own:

| What | Where it goes | How to get it |
|---|---|---|
| The Shopify dev store and its Dev Dashboard app | `.env`: `SHOPIFY_STORE` (the subdomain only, such as `nubandina-dev`), `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | [`docs/shopify-setup.md`](docs/shopify-setup.md) §1–8 |
| The Admin API token | `.env`: `SHOPIFY_ACCESS_TOKEN` | Written by `pnpm run shopify:token`, at mode 0600 |
| The storefront password | `.env`: `SHOPIFY_STOREFRONT_PASSWORD` | Shopify admin, **Online Store > Preferences**. Only `pnpm run lighthouse` reads it. |
| The store, again | `config/config.json`: `shopify.store` | Must equal `SHOPIFY_STORE`, or `pnpm run setup` stops |
| A Google Cloud project | `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Enable the Google Sheets API and the Gmail API. Create an OAuth client of type *Web application* with the redirect URI `http://localhost:5678/rest/oauth2-credential/callback`. Publish the OAuth consent screen to **Production**: in Testing, Google expires refresh tokens after 7 days. |
| The n8n owner account and Google sign-in | n8n itself | Create the owner account the first time you open <http://localhost:5678>. Then choose **Sign in with Google** on the "Google Sheets" and "Gmail" credentials; Gmail should ask only to send email. |
| ngrok | `.env`: `NGROK_AUTHTOKEN`, `NGROK_DOMAIN`, and `WEBHOOK_URL=https://<NGROK_DOMAIN>/` | An ngrok account with a static domain |
| The Orders sheet | `config/config.json`: `google.orders_sheet_id`, `google.orders_tab` | [`docs/shopify-setup.md`](docs/shopify-setup.md) §9 |
| The rest of the config | `config/config.json`: `owner_email`, `low_stock_threshold`, `guide_delay_minutes` (2 or more), `default_locale`, `team_locale` | `pnpm run check:config` validates the file |
| The free-shipping threshold | The theme setting **Theme settings > Free shipping bar** | Equal to the free shipping rate's minimum, 120,000 COP ([`docs/shopify-setup.md`](docs/shopify-setup.md) §5) |

### Languages

English is the source language; Spanish lives only in translation files and message tables.

- **Storefront.** Spanish is served under `/es`. Visitors reach it through Horizon's header language selector, which appears once Spanish is published; Shopify doesn't switch on its own. The theme's strings are in `theme-locales/` (see [`theme/README.md`](theme/README.md#translations)); product content is translated in Shopify's Translate & Adapt app. Don't translate the Roast or Brew method metafields there: the coffee finder compares their values with fixed English keys, so a translated value matches nothing.
- **Customer emails.** The brewing guide is written in the order's own `customer_locale`; set `default_locale` in `config/config.json` (`en` or `es`, default `en`) for orders without one. The guide's text is in `data/brewing-guides.json`: English at each guide's top level, Spanish under `translations.es`.
- **Owner emails.** Set `team_locale` (`en` or `es`, default `en`) to switch the order summary, low-stock, and error alerts.
- **Adding a language** takes a translation file per platform: `theme-locales/<code>.json` and `<code>.schema.json` for the theme, a `translations.<code>` entry per brewing guide, a message-table entry in each email Code node (`src/nodes/select-guides.ts`, `owner-summary.ts`, `select-low-stock.ts`, `error-alert.ts`), and the code in `src/lib/locale.ts`'s `LOCALES`. `AGENTS.md`'s "Languages" section lists the steps.

## Test scenarios

Everything under "Verified offline" runs in CI or locally with no third-party account. The rest needs the live accounts above.

### Verified offline

| Check | Command | Result |
|---|---|---|
| Types, lint, and every Vitest suite ([`docs/testing.md`](docs/testing.md)) | `pnpm run typecheck && pnpm run lint && pnpm test` | All pass, including the coffee finder and the free-shipping bar run in happy-dom |
| Code nodes match their TypeScript, and workflow hygiene | `pnpm run build:workflows -- --check && pnpm run check` | No drift, no violations |
| Shopify's theme check on the assembled theme | `pnpm run theme:check` | `failing: 0` across this repo's 5 added and 62 modified files; Horizon's own baseline is printed, not asserted |
| Accessibility of both components | `pnpm run theme:preview` (add `-- --locale es`), `python3 -m http.server 8765 --directory .theme-build/preview`, then open <http://localhost:8765> in Chrome at 390 and 1280 px and run the [axe DevTools](https://www.deque.com/axe/devtools/) extension's full-page scan (axe-core 4.14.0) in each state | No violations in either component, or on the page, in any state at 390 and 1280 px; a focus ring at every stop of the finder's keyboard path |
| The published workflow chain executes | CI's `n8n` job | Boots n8n and Postgres, runs `pnpm run setup`, and calls `load-config` and `intake-order` through the dev harness; the `es-CO` fixture order comes back with locale `es` |
| Least-privilege database role | `node scripts/check-db.ts` | Only `ok` lines: `app_runtime` holds `SELECT, INSERT` on `orders` and nothing else |
| The harness's response shapes | `node scripts/check-dev-response.ts` | Exits 0 |
| Queue mode | `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` | Redis, n8n, and two workers up healthy |
| Supply chain and runtime | `pnpm test` (`tests/supply-chain.test.ts`, `tests/runtime.test.ts`) | pnpm's release-age gate, trust policy, and build-script approval are in effect; every Compose image is pinned by digest; n8n mounts the config, the guides, and the workflows read-only, and publishes only on `127.0.0.1` |
| Credentials never touch the host | `pnpm run setup` | Credential JSON streams into the container over stdin, and only names and IDs are printed |
| Idempotent setup | `pnpm run setup`, `pnpm run export`, twice | `git diff --exit-code workflows/` is empty |
| The dev harness's guard | `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:5678/webhook/dev -H 'Content-Type: application/json' -d '{"target":"load-config","input":{}}'` (no token), `DEV_HARNESS_TOKEN=wrong node scripts/dev-call.ts load-config '{}'`, then `node scripts/dev-call.ts unknown '{}'` | 403, 403, then 404 |
| A missing config doesn't loop | `mv config/config.json config/config.json.hidden && node scripts/dev-call.ts load-config '{}'; sleep 20; mv config/config.json.hidden config/config.json` | The call fails, and n8n's Executions list shows one `error-handler` run, not a loop |

### The four test orders

Placed on the storefront with the Bogus Gateway, with `guide_delay_minutes: 2`:

| # | Cart | Sheet: subtotal / shipping / total / free_shipping | Low-stock email | Guide sections |
|---|---|---|---|---|
| 1 | Sierra Nevada 250 g × 1, shipping name `=1+1` | 38000 / 12000 / 50000 / no; `customer` shows `=1+1` as text | none | Espresso |
| 2 | Huila 250 g + Huila 500 g | 120000 / 0 / 120000 / yes | none | French press |
| 3 | Sierra Nevada 500 g × 2 | 136000 / 0 / 136000 / yes | Sierra Nevada (500 g): 4 left | Espresso |
| 4 | Nariño 250 g + Sierra Nevada 250 g | 84000 / 12000 / 96000 / no | none | Pour-over and Espresso |

### Theme performance

Not measured yet. Push both themes unpublished, `pnpm dlx @shopify/cli@5.0.0 theme push --unpublished --theme "Horizon base" --path .theme-build/horizon-<commit in scripts/lib/horizon.ts> --store <store>.myshopify.com` and the "Nubandina demo" push from the quick start, then read their IDs with `pnpm dlx @shopify/cli@5.0.0 theme list --store <store>.myshopify.com` and run:

```sh
pnpm run lighthouse -- --base-theme <Horizon base id> --theme <Nubandina demo id>
```

Before the first run, `pnpm dlx lighthouse@13.3.0 --version` should print `13.3.0`: `pnpm dlx` resolves Lighthouse's dependencies fresh under this repo's trust policy, so a new upstream release can block it on the day.

It runs Lighthouse's mobile defaults 5 times per theme, alternating, and prints the medians and the row below. Nubandina passes when it's no more than 2 points below Horizon on Performance and not lower on Accessibility. The 2 points are a chosen tolerance, not Lighthouse's measured spread: mobile Performance can move by more between runs, so on a near miss re-run with `--runs 9`. Each run must end on the requested theme preview, not the password page or the published theme, or the script stops naming the URL it ended on. Both themes are measured with Shopify's preview bar for unpublished themes, so the absolute numbers aren't a published storefront's; the comparison still holds.

| Date | Horizon performance | Nubandina performance | Horizon accessibility | Nubandina accessibility | Passes |
|---|---|---|---|---|---|

### Live checks (pending)

**Shopify setup**

- **Admin API token.** `pnpm run shopify:token` prints `Saved SHOPIFY_ACCESS_TOKEN (scopes: read_inventory, read_orders, read_products; expires: never)`, and `stat -f '%Lp' .env` prints `600`. Note whether Shopify accepted `https://127.0.0.1/shopify/callback` or `--client-credentials` was needed.
- **Catalog import.** Products shows 3 products and 6 variants. Each has Roast, Tasting notes, Brew method, and an image. Stock is 40 per variant, except Sierra Nevada 500 g at 6.
- **Paid shipping.** Sierra Nevada 250 g × 3 (114,000 COP): the bar shows "You’re $6.000 away from free shipping", and checkout charges 12,000 shipping.
- **Subscription.** Load `.env` with `set -a; . ./.env; set +a`, then run:

  ```sh
  curl -s -X POST "https://$SHOPIFY_STORE.myshopify.com/admin/api/2026-10/graphql.json" -H "X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"query":"{ webhookSubscriptions(first: 10) { nodes { topic uri } } }"}'
  ```

  It lists exactly one `ORDERS_CREATE`, at `https://<NGROK_DOMAIN>/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook`.
- **Subscription cycle.** `curl -s "https://$SHOPIFY_STORE.myshopify.com/admin/api/2026-10/webhooks.json" -H "X-Shopify-Access-Token: $SHOPIFY_ACCESS_TOKEN"` before and after `pnpm run setup -- --live` (with `.env` loaded as above) shows one `orders/create` subscription each time, with a new `id` after.
- **Delivery log.** For each test order, the app's webhook deliveries in the Dev Dashboard show one `orders/create` with response 200, and n8n shows one "Shopify orders" execution.

**Google**

- **Gmail re-consent.** Run `pnpm run setup -- --refresh nbcCredGmail0001` and re-authorize the Gmail credential in the n8n editor. The Google consent screen shows only "Send email on your behalf". The old, broader grant stays valid until it's revoked under your Google Account's [third-party access](https://myaccount.google.com/connections).
- **Google consent.** Google Auth Platform > Audience shows "In production". A test order 8 or more days after signing in still writes its row.

**Order backend**, with `shopify-orders` published by `--live`:

- **A valid order.** `pnpm run send-test-order -- --fixture below-threshold --order-id <digits>` produces one "Shopify orders" execution, one "Intake order" execution, and one `orders` row.
- **A repeat.** The same order sent again produces another "Shopify orders" execution, but its "Intake order" stops at "Is new order?", and the `orders` row count doesn't change.
- **Sheet row.** A signed test order (`--fixture free-shipping`) adds exactly one `Orders` row and sends one owner email. The row matches the first test in `tests/nodes/order-row.test.ts`, except `order_number` (`#T<digits>`).
- **Re-sent after its row is deleted.** Delete the order's `orders` row (`docker compose exec -T postgres sh -c "psql -U \"\$APP_DB_USER\" -d app -c \"DELETE FROM orders WHERE order_id = '<digits>'\""`, so the container expands `$APP_DB_USER`, not the host), then send it again with the same `--order-id`. Its `Orders` row is updated, not duplicated. n8n refuses to retry a successful execution, so this re-sends the order instead.
- **Formula-like names.** An order whose shipping name is `=1+1` shows the literal text `=1+1` in the `customer` cell.
- **Expression-like names.** An order whose shipping name is `| json` or contains `<!--` shows the literal text in the `customer` cell and the owner email, with no n8n expression evaluated and no HTML comment swallowing the rest of the email.
- **Guide escaping.** A real order whose first name is `<b>Ana</b> O'Neil & Co` gets a guide that greets "Hi <b>Ana</b> O'Neil & Co," as literal text, with no bold.
- **Tampered signature.** `pnpm run send-test-order -- --tamper --order-id <digits>` gets HTTP 200, starts no execution, and creates no row.
- **Payload fields.** In one real order's execution data, every field `normalize-order` reads is present (`admin_graphql_api_id`, `name`, `email`, `shipping_address.name`/`city`, `line_items[].variant_id`/`variant_title`/`sku`, `total_shipping_price_set`, `shipping_lines`). If a field moved, update the fixture and the mapper.
- **Low stock.** A real order of 2 × Sierra Nevada 500 g (stock 6) sends `Low stock after order <#>` with the line `Sierra Nevada (500 g), SKU NBC-SNV-500: 4 left (threshold 5)`. An order of Huila 250 g sends no alert.
- **Unknown variants.** A signed fixture order, whose variants don't exist in the store, sends no alert and doesn't fail.
- **Stock-read failure.** Setting `config.shopify.store` to a store subdomain that doesn't exist makes the stock read fail after its retries, and the error workflow emails the owner. After restoring the subdomain, the next order reads stock again. Retrying the failed run from the UI fails again, because a retry reuses the config the run started with.
- **Activation error.** Put an invalid `SHOPIFY_ACCESS_TOKEN` in `.env`, run `pnpm run setup -- --refresh nbcCredShopify01 --live`, then `docker compose restart n8n`. The owner gets an error alert with `Failed node: activation` and `n/a (activation error)`. Restore the real token and re-run the same `setup` command, only when no orders are expected.
- **Sheets failure.** Set `google.orders_sheet_id` to `invalid-sheet-id`, then run `pnpm run send-test-order -- --fixture below-threshold --order-id <digits>`. An error alert names "Upsert order row" with an execution link. "Shopify orders" and "Intake order" succeed, since `intake-order` doesn't wait for `process-order`, and a retry of the failed "Process order" execution would reuse the bad id. So restore the id, delete the order's `orders` row (the `DELETE` command above), and re-send the same order with `pnpm run send-test-order -- --fixture below-threshold --order-id <same digits>`. Exactly one sheet row results, and the failed "Process order" execution stays failed.
- **Two methods.** With `guide_delay_minutes: 2`, a real order of Nariño 250 g plus Sierra Nevada 250 g gets one email, about 2 minutes later, with Pour-over and Espresso sections.
- **Restart during the wait.** Restarting n8n (`docker compose restart n8n`) during a wait still delivers the guide.
- **No email address.** An order without one sends no guide and doesn't fail.
- **Real delay.** With `guide_delay_minutes` back at 60, one order's guide arrives about an hour later. n8n shows the execution as waiting until then.
- **Live file edits.** Editing a step in `data/brewing-guides.json` changes the next guide, with no re-import.
- **Spanish guide.** A real order placed on the Spanish storefront carries `customer_locale` `es` (or `es-CO`), and its guide arrives in Spanish ("Cómo preparar su café Nubandina"). An order placed in English gets the English guide.
- **Error alert in n8n.** The stock-read failure above sends its alert through `Collect alert input` and `Build error alert`, in English, and in Spanish once `team_locale` is `es`.
- **Team locale.** With `team_locale: "es"`, the next order's summary reads "Nuevo pedido …" with amounts like `96.000 COP`, and a low-stock alert reads "Inventario bajo tras el pedido …".

**Tunnel and queue mode**

- **Tunnel.** `for p in / /rest/login /webhook-test/x /webhook/dev/x //webhook/x; do curl -s -o /dev/null -w "%{http_code} $p\n" "https://$NGROK_DOMAIN$p"; done` prints 404 for each path, and only the trigger's own path reaches n8n.
- **Rate limit.** `for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$NGROK_DOMAIN/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook" -H 'Content-Type: application/json' -d '{}'; done | sort | uniq -c` shows HTTP 429 once the policy's 60 requests a minute are used up. A minute later, a signed `pnpm run send-test-order` still makes exactly one "Shopify orders" execution.
- **Queue mode.** With `compose.queue.yaml` and two workers, a signed order runs on a worker and adds its `Orders` row.
- **Container hardening.** `docker inspect --format '{{.Name}} {{.HostConfig.SecurityOpt}} {{.HostConfig.CapDrop}}' $(docker compose -f compose.yaml -f compose.queue.yaml --profile tunnel ps -q ngrok redis n8n-worker)` shows `[no-new-privileges:true]` for every container, and `[ALL]` as `CapDrop` for each `n8n-worker`, inherited from the `n8n` service it extends.

**Storefront**, with `pnpm dlx @shopify/cli@5.0.0 theme dev` against `.theme-build/theme`:

- **Drawer.** With Sierra Nevada 250 g in the cart, the bar shows "You’re $82.000 away from free shipping" at 31%.
- **Live updates.** Raising the quantity to 4 (152,000 COP) switches it to "You’ve got free shipping!" without a reload, in the drawer and on `/cart`. Lowering it again restores the remaining message.
- **Boundary.** Huila 250 g plus Huila 500 g (exactly 120,000 COP) shows the reached message, and checkout charges 0 shipping.
- **Disabled.** A blank threshold, or unticking "Show the free shipping bar", hides the bar with no console errors.
- **Screen reader.** VoiceOver reads the bar as "Progress toward free shipping" with its message as the value, and announces a cart change once, never on page load.
- **Keyboard path.** Tab reaches each radio group and arrow keys move within it. Submitting "Pour-over / Mild and bright / Just me" moves focus to "Our pick for you", which shows one card: Nariño 250 g, its price, and its notes.
- **Unanswered question.** Submitting with only a brew method chosen marks the other two questions, announces "Choose an answer for each question.", and moves focus to the taste question.
- **Adding to cart.** "Add to cart" with Enter shows the busy ring, keeps focus on the button, opens the cart drawer, and the free-shipping bar reflects the new total.
- **Second option.** "Espresso / Mild and bright / Three or more" shows two cards, Sierra Nevada 500 g and then Nariño 500 g.
- **Theme editor.** The section can be added to another page, its texts edited, and the section removed, all without code.
- **No errors.** The console shows no errors, and `Shopify.actions` is present. Note it if it's absent: the Cart AJAX fallback then handles "Add to cart".
- **Brand.** The theme editor shows the six palette colors and the Alegreya fonts, both fonts load from Shopify's font CDN, and Horizon's own muted text (the footer copyright) uses the raised 0.65 opacity.
- **Spanish storefront.** With Spanish published, `/es` shows the finder and the free-shipping bar in Spanish; `theme/README.md` lists the translation checks.
- **Language selector.** With Spanish published, the header selector switches to `/es`. An order placed there carries `customer_locale` `es` in "Normalize order"'s output, and its guide arrives in Spanish.
- **Finder after Translate & Adapt.** On `/es`, "Pour-over / Suave y brillante / Solo yo" still shows one card, with Nariño's translated title. Translate & Adapt lists no Spanish value for Roast or Brew method.
- **Lighthouse.** As under "Theme performance" above. Then open one base and one theme report from `.lighthouse/<date>/` in the [Lighthouse viewer](https://googlechrome.github.io/lighthouse/viewer/) and confirm the final screenshot shows the right theme.

**From a clean clone**

- **Clean clone.** Stop the main stack (`docker compose stop`), then `git clone https://github.com/aabv21/shopify-coffee-store /tmp/nubandina-check`. In the clone, with `COMPOSE_PROJECT_NAME=nubandina-check` exported, copy in `.env` and `config/config.json`, and follow Quick start and Configuration exactly, including the n8n owner account and both Google sign-ins. The gate passes, the workflows import with no secrets, and a signed test order makes one row and one owner email. Finish with `docker compose down -v` in the clone only.

## Design decisions and production notes

- **The intake split.** `shopify-orders` holds only the Shopify Trigger and a hand-off, because a webhook-started run calls only published workflows and the trigger publishes only with the live credential; `intake-order` holds the rest and runs offline. See [the workflows](docs/architecture.md#the-workflows-and-what-starts-them).
- **Idempotency in Postgres before any side effect.** One `INSERT … ON CONFLICT DO NOTHING` checks and records the order in a single statement, so two deliveries can't both pass. See [how an order moves](docs/architecture.md#how-an-order-moves-from-checkout-to-the-brewing-guide).
- **A persisted wait.** The brewing guide waits as an execution in Postgres and resumes with its own data: no queue table, no polling workflow. See [design decisions](docs/architecture.md#design-decisions-each-over-its-alternative).
- **The GraphQL node for stock.** Shopify reports throttling as HTTP 200 with an `errors` array; only the GraphQL node throws on it, so its retries apply. See [design decisions](docs/architecture.md#design-decisions-each-over-its-alternative).
- **An overlay plus anchored insertions, not a Horizon fork.** The repo holds only its own files and a pinned Horizon commit; a moved anchor fails assembly instead of editing the wrong line. See [`theme/README.md`](theme/README.md#how-assembly-works).
- **Send-only Gmail.** The Gmail credential is narrowed to `gmail.send`, so the n8n instance can't read the mailbox. See [security](docs/architecture.md#security-signatures-secrets-and-untrusted-text).
- **Production notes.** Queue mode (`compose.queue.yaml`) is worth it once executions back up behind the single process; give its Redis a password first. Keep the Google OAuth app in Production, or sign-ins expire after 7 days. Unpublish the dev harness before any production use. See [scaling](docs/architecture.md#where-the-default-stack-stops-scaling).

## Limitations

Deliberate simplifications, each with its ceiling and upgrade path:

- **`intake-order` processes only the first order of a call.** `Process order`'s input reads `.first()` off `Normalize order`'s output, which is exact while a webhook call carries one order, as it does today. Upgrade path: read the order from the current item (`.item`).
- **Shopify gets its HTTP 200 before the order is recorded.** The Shopify Trigger answers on receipt, so a later failure (a database outage, a bad hand-edited config) shows up only in n8n's executions list, never as a failed delivery in Shopify.
- **The Shopify trigger needs a valid token at every n8n start.** An invalid or expired one is an activation error, and orders placed meanwhile are lost. Upgrade path: the offline token from `pnpm run shopify:token`, which doesn't expire.
- **The `--client-credentials` token expires after 24 hours.** Re-run it daily, then `pnpm run setup -- --refresh nbcCredShopify01 --live`. Upgrade path: the authorization code grant's offline token.
- **A lost `Record order` response can strand an order with no alert.** If the INSERT commits but its response never reaches n8n, the retry's `ON CONFLICT DO NOTHING` reports the same `{success: true}` a real duplicate would. See `AGENTS.md`'s recovery steps.
- **"Read stock and brew methods" has no per-request timeout.** The GraphQL node exposes no `options.timeout`, so a hung response holds the run until n8n's own default ends it. Upgrade path: HTTP Request with `options.timeout` and an explicit `errors` check.
- **Stock is read seconds after the order,** so the low-stock alert reflects stock at read time, including any order placed in between. Upgrade path: subscribe to `inventory_levels/update` and alert from the stock change itself.
- **A wait shorter than 65 seconds doesn't survive a restart.** n8n persists a Wait node's sleep only past `MAX_IN_PROCESS_WAIT_MS` (traced in n8n 2.45.7's source); anything shorter stays in memory. `guide_delay_minutes` is validated at 2 or more for this reason. Upgrade path: none needed at this delay.
- **Queue mode's Redis has no password.** `compose.queue.yaml` publishes no Redis port, but any container on the Compose network can reach it. Upgrade path: set `QUEUE_BULL_REDIS_PASSWORD`.
- **`pnpm run setup` waits 15 seconds after restarting n8n, then polls the dev harness's webhook.** The poll proves the harness is live, not that every sub-workflow already runs its newest published version under a slower reconciler. Upgrade path: poll `workflow_published_version` against `workflow_entity.activeVersionId`.
- **Product content stays English on the storefront until Translate & Adapt runs.** Titles, tasting notes, and variant names are store data. The guide email always uses the order's line-item titles, which are in the store's default language. Upgrade path: the `read_translations` scope and a `translations(locale:)` lookup.
- **The finder compares untranslated Roast and Brew method values.** Translating those metafields in Translate & Adapt leaves the Spanish finder with no match. Upgrade path: match on a locale-independent value, such as a metaobject reference.
- **Horizon's own strings use *tú*; this repo's use *usted*.** Upgrade path: override those Horizon keys in `theme-locales/es.json`.
- **The free-shipping bar can disagree with checkout.** It reads `cart.total_price`, after cart-level discounts but before anything applied at checkout, so a checkout discount code can take the order below free shipping after the bar showed "You’ve got free shipping!".
- **The threshold is in the shop currency.** With Shopify Markets converting prices, the bar would compare a converted cart with a COP threshold. Upgrade path: read `cart.currency` and convert the threshold with presentment prices.
- **Taxes aren't configured.** The CSV sets `Charge tax` to `FALSE` for every variant. Upgrade path: set up Colombian VAT in Shopify and import with `Charge tax` on.
- **The guide email isn't consent-gated.** Every order with an email address gets it. Upgrade path: send it only when the order's `buyer_accepts_marketing` is true, or describe it at checkout as part of the order.
- **The dev store is password-protected.** Visitors need the storefront password until the store is on a paid plan and launched.
- **A Horizon upgrade needs the insertions re-anchored.** Each insertion throws when its anchor drifts, so an upgrade fails assembly until the anchors are updated.
- **A Google OAuth app left in Testing expires sign-ins after 7 days.** The Sheets and Gmail credentials then stop working. Upgrade path: publish the consent screen to Production.

## License

MIT, see [`LICENSE`](LICENSE). Product photos are from Burst, Shopify's free stock photo site; credits and licenses are in [`docs/shopify-setup.md`](docs/shopify-setup.md) §7.
