# How Nubandina Coffee works

This page follows one order from checkout to the brewing-guide email. It then covers storage, failure modes, scaling limits, security, and the design choices behind each part.

![System architecture: the storefront sends checkouts to Shopify; Shopify’s orders/create webhook reaches shopify-orders through ngrok; intake-order records each order once in Postgres and starts process-order, which writes the sheet row, reads stock from Shopify, waits in Postgres, and sends email through Gmail](diagrams/architecture.svg)

Both diagrams come from JSON sources in `docs/diagrams/`. [archify](https://github.com/tt-a1i/archify) renders each one as an SVG image and an interactive HTML page, and `AGENTS.md` lists the steps to regenerate them.

## Context: who uses it and where it runs

Nubandina Coffee is a fictional Shopify store in Colombia. It sells three coffees, Nariño, Huila, and Sierra Nevada, each in 250 g and 500 g bags, priced in Colombian pesos (COP). Shipping costs 12,000 COP and is free from 120,000 COP.

The repo holds two parts:

- **The storefront**: Shopify’s Horizon theme, plus a free-shipping progress bar in the cart and a coffee finder on the home page.
- **The order backend**: n8n workflows that record each new order once, log it to a Google Sheet, and email the owner. They also alert the owner to low stock and email the customer a brewing guide after a delay.

The backend runs as one Docker Compose project, `nubandina-coffee`:

- **n8n 2.45.6**: the workflow engine, with its port published on `127.0.0.1:5678` only
- **Postgres 17**: database `n8n` for n8n’s own data and database `app` for the `orders` table
- **ngrok** (profile `tunnel`): gives Shopify a public HTTPS address and forwards only the order webhook’s path
- **Redis and `n8n-worker`** (optional, `compose.queue.yaml`): queue mode, covered under scaling

The backend calls three external services. Shopify sends the order webhook and serves the GraphQL Admin API. Google Sheets and Gmail run under one Google account.

## The workflows and what starts them

Six n8n workflows make up the backend. Their fixed IDs live in `scripts/lib/manifest.ts`. Every one except `error-handler` and `load-config` names `error-handler` as its error workflow. `error-handler` calls `load-config`. An error workflow on the loader would therefore start a new `error-handler` run for every failed load, without end while the config file is missing.

| Workflow | Started by | What it does |
|---|---|---|
| `shopify-orders` | Shopify’s `orders/create` webhook, through n8n’s Shopify Trigger | `Receive order` checks the webhook’s signature. `Hand to intake` passes the order to `intake-order` and waits. |
| `intake-order` | `shopify-orders`, or the dev harness | Normalizes the order, records it once, stops a repeat, loads and checks the config, then starts `process-order` without waiting |
| `process-order` | `intake-order` | Writes the sheet row, emails the owner, reads stock from Shopify, alerts on low stock, waits, then emails the brewing guide |
| `load-config` | `intake-order`, `error-handler`, and the dev harness | Reads `/files/config/config.json` and returns `{ config }`, unvalidated |
| `error-handler` | Any other workflow’s failure, including a trigger that fails to activate | Emails the owner a plain-text alert with the failed node, the error, the execution link, and the time |
| `dev-harness` | `POST /webhook/dev` with an `X-Dev-Token` header, from localhost | Runs one of two targets, `load-config` or `intake-order` |

`shopify-orders` holds only the trigger and the handoff. A run started by a webhook can call only published workflows. n8n can’t publish `shopify-orders` without the live Shopify credential, because its trigger registers a webhook with Shopify on activation.

The rest of the chain sits in `intake-order`, whose trigger needs no credential, so it publishes and runs offline through the dev harness. `pnpm run setup` publishes `shopify-orders` only when it runs with `--live`.

Five Code nodes do work that no native node does. Each is a pure TypeScript function in `src/nodes/`, which `pnpm run build:workflows` bundles into the workflow JSON:

- `Normalize order` and `Check config`, in `intake-order`
- `Build order row`, `Select low-stock variants`, and `Build guide email`, in `process-order`

The workflows read their settings from `config/config.json`, which Compose mounts read-only at `/files/config/`. It holds the owner’s email, the sheet ID and tab name, the store subdomain and API version, the low-stock threshold, and the guide delay. Git ignores the file, and `config/config.example.json` is its template. `validateConfig` (`src/lib/config.ts`) checks it in `pnpm run check:config`, in `pnpm run setup`, and in the `Check config` node.

## The storefront and the token script

The theme is Shopify’s Horizon 4.3.0, pinned by commit in `scripts/lib/horizon.ts`. The repo never copies Horizon in. `pnpm run theme:assemble` downloads that commit, copies `theme/**` over it, and applies three anchored insertions from `scripts/lib/theme-insertions.ts`. The result in `.theme-build/theme/` is the theme you push.

- **Free-shipping bar** (`theme/snippets/free-shipping-bar.liquid`, `src/theme/free-shipping-bar.ts`): a `<free-shipping-bar>` element above the cart totals, in the cart drawer and on `/cart`. It shows how far the cart is from a threshold theme setting, 120,000 COP by default. Its math lives in `src/theme/free-shipping.ts` and `src/theme/money.ts`. It updates two ways: Horizon’s section morph copies its `data-total-cents` attribute after each cart change, and a `shopify:cart:lines-update` listener re-reads `/cart.js`.
- **Coffee finder** (`theme/sections/coffee-finder.liquid`, `src/theme/coffee-finder.ts`): a home-page section that asks for a brew method, a taste, and a party size. It recommends one or two coffees from each product’s `coffee.brew_method` and `coffee.roast` metafields, and shows `coffee.tasting_notes` on each card. “Add to cart” calls `Shopify.actions.updateCart`, or the Cart AJAX API when the page lacks it.

Shopify’s theme check runs in continuous integration (CI) against the assembled theme. Any error fails it, and so does any offense in a file this repo adds or changes. Horizon’s own warnings are an informational baseline, 6 at the time of writing.

`pnpm run shopify:token` gets the Admin API token for n8n’s Shopify credential, through Shopify’s authorization code grant. It prints an authorize URL and reads the callback URL back from stdin. After checking the callback’s signature, `state`, and `shop`, it trades the code for an offline token. It accepts exactly `read_orders`, `read_products`, and `read_inventory`, and saves the token in `.env`.

The script’s `--client-credentials` fallback works only when the app and the store share an organization, and its token expires after 24 hours.

## How an order moves from checkout to the brewing guide

The sequence diagram groups the path into seven bands, and the numbered steps below follow the same order:

![Order lifecycle: delivery and HMAC check, idempotency gate, config and hand-off, sheet row and owner email, stock check, persisted wait, and brewing guide](diagrams/order-sequence.svg)

1. **Delivery and HMAC check**: After checkout, Shopify posts the `orders/create` webhook to the ngrok address, which forwards only `/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook`. The Shopify Trigger requires the topic, shop, and API-version headers. It computes the body’s HMAC-SHA256, a hash-based message authentication code, with the app’s client secret and compares it with `X-Shopify-Hmac-Sha256`. A match starts an execution. n8n answers HTTP 200 on receipt, before any node runs.
2. **Idempotency gate**: `Hand to intake` passes the order to `intake-order` and waits. `Normalize order` turns the payload into one order object, taking the ID from `admin_graphql_api_id`. It throws on a payload with no ID, order number, or line items, or with a missing or non-numeric amount. `Record order` then runs `INSERT INTO orders … ON CONFLICT (order_id) DO NOTHING RETURNING order_id`. A repeat inserts nothing, but the Postgres node still emits one `{ success: true }` item. So `Is new order?` checks for `order_id`, and stops a repeat there.
3. **Config, then hand-off**: `Load config` reads the mounted file, and `Check config` validates it. A bad value fails the run here, after `Record order`. `Process order` then starts `process-order` with the order and the checked config, without waiting for it.
4. **Sheet row and owner email**: `Build order row` converts the order time to Bogota time and joins the line items into one text field. `Upsert order row` writes the row to the `Orders` tab, keyed by `order_number`, with raw cell values. `Email owner` sends a plain-text summary.
5. **Stock check**: `Read stock and brew methods` sends one GraphQL `nodes` query for the order’s variants. It reads each variant’s stock and tracking, and its product’s `coffee.roast` and `coffee.brew_method`. `Select low-stock variants` keeps each tracked variant with less stock than `low_stock_threshold`, and skips variants Shopify no longer has. When any are low, `Email low-stock alert` sends the owner one plain-text list.
6. **Persisted wait**: `Wait before guide` waits `guide_delay_minutes`, 60 in the example config. n8n stores the waiting execution in Postgres and resumes it when the time comes, even after a restart.
7. **Brewing guide**: `Read brewing guides` reads `/files/data/brewing-guides.json`. `Build guide email` picks one guide per brew method among the order’s variants and builds an HTML email with every value escaped. `Email brewing guide` sends it only when the order has an email address and at least one guide matched.

## What the system stores, and for how long

The Orders sheet is the business record. Postgres holds only what the gate and the wait need:

| Store | What it holds | How long |
|---|---|---|
| Table `orders` in database `app` | One row per order seen: `order_id` (primary key), `order_number`, and `received_at` | Until someone deletes it; no job prunes it |
| Database `n8n`, plus volume `n8n_data` | n8n’s workflows; its credentials, encrypted with `N8N_ENCRYPTION_KEY`; and its executions, which include each order’s full webhook payload with the customer’s name, email, and address. A waiting order is an execution here too. | Execution data: 168 hours (`EXECUTIONS_DATA_MAX_AGE`) |
| The Google Sheet’s `Orders` tab | One row per order, keyed by `order_number`: `date`, `order_number`, `customer`, `city`, `products`, `units`, `subtotal`, `shipping`, `total`, and `free_shipping` | Until the owner deletes it |
| The demo Google account’s Gmail | Every email the backend sent: owner summaries, stock alerts, error alerts, and customer guides | Until someone deletes it |
| Files under `/files`, read-only | `config/config.json` and `data/brewing-guides.json`. n8n reads each one when a run needs it, so an edit applies to the next run with no re-import or restart. | On disk; git tracks the guides but not the config |
| Shopify | Products, stock, and the product metafields `coffee.roast`, `coffee.tasting_notes`, and `coffee.brew_method`. The stock query reads `roast` and `brew_method`; the coffee finder reads all three. | Shopify’s own data |
| Theme settings | The “Free shipping bar” group: on or off, the threshold, the two messages, and the progress bar’s label | In the theme |

## Failure modes: behavior, detection, and recovery

Each row gives a failure’s behavior, the signal you’d notice, and the fix. Unless a row says otherwise, every Postgres, Google Sheets, Gmail, and GraphQL call makes 3 tries, 1000 ms apart. An Execute Workflow call never retries, since a retry would repeat a sub-workflow’s side effects. When a failure outlasts its retries, the execution fails and `error-handler` emails the owner.

A retry from n8n’s executions list resumes at the failed node and reuses the stored output of every node before it. That includes the config passed down, so a config fix doesn’t reach a retry that resumes after the config was loaded. The [guardrails in `AGENTS.md`](../AGENTS.md#guardrails) spell out the longer recoveries.

| Failure | Behavior | Detection | Recovery |
|---|---|---|---|
| A forged or tampered webhook | The signature check fails, so no execution starts. n8n still answers `200 {"message":"Webhook call received"}`. | None needed | None needed |
| The client secret in n8n is wrong or rotated | Every real order fails the same check, and n8n drops it. Shopify sees a 200 and never retries, and no error email goes out. | Shopify’s webhook delivery log lists deliveries that n8n’s executions list lacks | Put the app’s current secret in `SHOPIFY_CLIENT_SECRET`. If the old secret was revoked, the offline token died with it, so run `pnpm run shopify:token` too. Then run `pnpm run setup -- --refresh nbcCredShopify01 --live`, and rebuild each lost order by hand: its sheet row, and its brewing guide if it has an email address. |
| Shopify delivers an order twice | `Record order` inserts nothing, and `Is new order?` stops the run. | A short `intake-order` execution that ends at the gate | None needed |
| n8n or the tunnel is down when Shopify delivers | A delivery fails without a 2xx response within 5 seconds. Shopify retries it up to 8 times in 4 hours, then removes the subscription if failures persist ([webhook troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks)). The trigger recreates its subscription only when it activates, after looking for one at its exact address. | Failed deliveries in Shopify’s delivery log, and `docker compose ps` | Bring n8n and the tunnel back; a retry inside the 4 hours then succeeds. After a removal, run `docker compose restart n8n` to recreate the subscription, and rebuild each missed order by hand: its sheet row, and its brewing guide if it has an email address. |
| `pnpm run setup -- --live` runs while orders arrive | Importing `shopify-orders` unpublishes its trigger, which deletes its Shopify subscription. Publishing and the restart create it again. Shopify sends nothing for an order placed while no subscription exists, so that order never arrives (traced in n8n 2.45.6’s source; not yet seen live). | An order in Shopify with no `orders` row | Run `setup` only when no orders are expected. Rebuild a missed order by hand: its sheet row, and its brewing guide if it has an email address. |
| n8n crashes after answering Shopify, before `Record order` | Shopify already has its 200, so it doesn’t retry, and the order is lost. | A crashed `shopify-orders` or `intake-order` execution | Rebuild the order by hand: its sheet row, and its brewing guide if it has an email address. For a test order, re-send it. |
| The `Record order` response is lost | The insert committed, but n8n never saw the reply, so the node’s retry finds the row and gets `{ success: true }`. The order stops at the gate with no alert. | An order in Shopify with no sheet row, but with an `orders` row | For a real order, rebuild it by hand: its sheet row, and its brewing guide if it has an email address. For a test order, delete its `orders` row and re-send it. |
| An order fails after `Record order`, for example on a bad config value or with `process-order` unavailable | The run fails after `Record order`, and the owner gets an alert. Re-sending the order would stop at the gate. | The `error-handler` email | Fix the cause, delete the order’s `orders` row, then retry the failed `shopify-orders` execution, which calls `intake-order` afresh. Retrying `intake-order` itself would reuse the config it already loaded. |
| A failure in `intake-order` | n8n runs the error workflow for the failed `intake-order` execution and again for `shopify-orders`, which waited on it. A local drill showed the same double dispatch with the dev harness and the workflow it calls. The order path itself is not yet seen live. | Two emails that name two executions of one order | None needed; both emails describe one failed order. |
| n8n crashes mid-execution | n8n doesn’t resume a running execution; on its next start it marks it crashed (traced in n8n 2.45.6’s source; not yet seen live). A waiting execution isn’t running, so the next row applies to it instead. | A crashed execution in the executions list | Check which steps finished, in the sheet and the inbox, and finish the rest by hand. Repeating the sheet upsert is safe; repeating an email isn’t. |
| n8n restarts during the guide wait | n8n stores a wait of 65 seconds or more in Postgres. Its WaitTracker checks for due waits every 60 seconds, so the guide still goes out, late if n8n was down past its time. | The execution shows as waiting until it resumes | None needed |
| `config.json` is missing or isn’t JSON | `Read config file` has Always Output Data on, so `Parse config` throws instead of stopping silently. The order fails after `Record order`, and `error-handler` runs for `intake-order` and `shopify-orders`. It can’t email, because it loads the same file, so each run fails once and stops. There’s no loop, because `load-config` has no error workflow. | Only n8n’s executions list | Fix the file; `pnpm run check:config` validates it, and n8n reads it on every run. Then recover each order as in the failed-after-record row. |
| `config.json` has a bad value | `Check config` throws an error naming the first bad key. `error-handler` doesn’t validate the config, so its email still goes out, unless `owner_email` itself is the bad value. | The `error-handler` email | Fix the value, then recover each order as in the failed-after-record row. |
| The guides file is missing or isn’t JSON | `Read brewing guides` has Always Output Data on, so `Parse guides` throws after the wait. The sheet row, the owner email, and any stock alert already went out. | The `error-handler` email | Restore `data/brewing-guides.json`, then send that order’s guide by hand: a retry resumes at `Parse guides` with the failed read and fails again. |
| The Shopify token is revoked | The trigger checks its subscription on every activation, so activation fails at startup. n8n runs the error workflow with trigger data only: the email names the failed node as `activation` and quotes the trigger’s error. A running order’s stock read fails too. | The `error-handler` email | Get a new token with `pnpm run shopify:token`, then run `pnpm run setup -- --refresh nbcCredShopify01 --live`. |
| The client-credentials token expires | The fallback’s token lasts 24 hours ([access tokens](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens)). After that, each order’s stock read fails with HTTP 401, after the owner email went out. The next restart fails activation, as in the previous row. | `error-handler` emails | Run `pnpm run shopify:token -- --client-credentials` and then `pnpm run setup -- --refresh nbcCredShopify01 --live` daily. Then retry each failed `process-order` execution, which picks up the new token. |
| A GraphQL error or throttle | The GraphQL node throws on any `errors` array, including `THROTTLED`, which Shopify returns with HTTP 200 ([response codes](https://shopify.dev/docs/api/usage/response-codes)), so its retries apply. A response with no `data.nodes` makes `Select low-stock variants` throw. A retired `api_version` doesn’t fail: Shopify answers with its oldest supported version ([versioning](https://shopify.dev/docs/api/usage/versioning)). | The `error-handler` email | If it failed at `Read stock and brew methods`, retry the failed `process-order` execution once Shopify answers; it resumes at the stock read. If it failed at `Select low-stock variants`, a retry reuses the stored response and fails again, so check that order’s stock in the admin and send its guide by hand. |
| `SHOPIFY_STORE` and `config.shopify.store` differ | The credential comes from `.env` and the GraphQL URL from the config, and nothing compares them. The stock read then sends one store’s token to the other store, and fails. | The `error-handler` email | Make both name the same store. If `.env` was wrong, get a token for the right store with `pnpm run shopify:token`, run `pnpm run setup -- --refresh nbcCredShopify01 --live`, and retry. If the config was wrong, a retry still uses it, so finish that order’s stock check and guide by hand. |
| Google Sheets is down, or the tab or its header changed | `Upsert order row` fails after its retries, before the owner email. A renamed tab fails with `Sheet with name … not found`. A header that lacks one of the ten names fails with `Column names were updated after the node's setup`. | The `error-handler` email | Restore the service, the tab name, or the header row, then retry the failed `process-order` execution. The upsert matches on the order number, so a retry can’t add a second row. |
| Gmail is down or refuses to send | The send fails after its retries. The owner email comes before the stock read, so its failure also stops the stock check and the guide. | The `error-handler` email, if Gmail still works for the owner; otherwise only the executions list | Retry the failed `process-order` execution once Gmail answers. |
| Postgres is down | If only database `app` fails, `Record order` fails after its retries, after Shopify already got its 200. If the whole server is down, n8n fails too, because its own database lives there. | Two `error-handler` emails, or `docker compose ps` showing `postgres` unhealthy | Restore Postgres, then retry the failed `shopify-orders` execution. The order never reached `orders`, so it passes the gate. |
| Customer data is missing or redacted | A guest checkout or redacted fields arrive empty. `Normalize order` takes the name from the shipping address, the billing address, then the customer record, and the city from the shipping or billing address; it leaves `customer` or `city` blank when those are empty. No guide goes out without an email address. Custom apps always get protected customer data levels 1 and 2, which include name, email, and address. Development stores need no review ([protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)). | Blank `customer` or `city` cells | None needed |
| Stock changes between the order and the stock read | The alert reports stock at read time, which can include later orders or restocks. | None | Check the admin before acting on an alert. |
| `Shopify.actions` is missing from the storefront | The coffee finder adds through the Cart AJAX API (`/cart/add.js`) instead, then goes to the cart page. | None needed | None needed |
| A Horizon upgrade moves an anchor | Assembly throws `InsertionError`, naming the file and anchor, instead of inserting in the wrong place or twice. | `pnpm run theme:assemble` or `pnpm run theme:check` fails, locally and in CI | Update the anchor in `scripts/lib/theme-insertions.ts` for the new Horizon commit. |
| The bar and checkout disagree | The bar reads `cart.total_price`, which includes cart-level discounts but not a discount code entered at checkout. Such a code can take the order below 120,000 COP after the bar showed free shipping. | A customer charged shipping after the bar said it was free | None in the theme; it’s a known limitation. |

## Where the default stack stops scaling

The default stack is one n8n process, one Postgres server, and one Google account. Each limit below names its ceiling and the change that lifts it. The external limits come from each provider’s page, checked on 2026-11-01.

- **One n8n process**: `compose.queue.yaml` adds Redis 8.8.4 and `n8n-worker` containers, which run executions instead of the main process. Offline, `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` brought Redis, n8n, and two workers up healthy. Running a signed order on a worker is still a pending live check. The override gives Redis no password, so set `QUEUE_BULL_REDIS_PASSWORD` before production use.
- **Waiting executions**: Each order waits `guide_delay_minutes` as an execution in Postgres. At the default 60 minutes, the last hour’s orders are always waiting. The main process’s WaitTracker polls for due waits every 60 seconds.
- **Shopify webhooks**: Shopify fails a delivery that gets no response within 5 seconds ([webhook troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks)). The trigger answers on receipt, so processing time never counts against that.
- **Shopify’s GraphQL Admin API**: Each order sends one query, whose cost grows with its distinct variants: six at most in this catalog. Shopify budgets each app and store by query cost, from 100 points per second on the Standard plan to 2,000 on Shopify for enterprise ([rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)). No single query may cost more than 1,000 points. A throttled query returns HTTP 200 with a `THROTTLED` error ([response codes](https://shopify.dev/docs/api/usage/response-codes)). The GraphQL node throws on that error, so its 3 tries cover a short throttle. The node has no timeout setting, so a hung response holds the run until n8n’s 300-second HTTP default ends it.
- **Google Sheets**: The API allows 60 reads and 60 writes per minute per user per project, and 300 of each per project ([Sheets API limits](https://developers.google.com/workspace/sheets/api/limits)). Each new order makes two reads, to find the tab and to read it, and two writes, to add a row and fill it. So one account tops out near 30 orders a minute on either quota. Past a quota, the API answers 429, which 3 tries 1000 ms apart can’t outlast, so the order fails with an alert. The second read covers the whole tab, so it grows with the sheet. Upgrade: start a new tab each year by changing `orders_tab`.
- **Gmail**: Each order sends up to three emails: the owner summary, a stock alert, and the guide. Google may stop a personal account from sending for 1 to 24 hours after more than 500 emails in a day ([Gmail sending limits](https://support.google.com/mail/answer/22839)). That caps the account near 165 orders a day. The Gmail API also allows 6,000 quota units per minute per user, and a send costs 100, so 60 sends a minute ([Gmail API limits](https://developers.google.com/workspace/gmail/api/reference/quota)). A Google Workspace account has [its own limits](https://support.google.com/a/answer/166852). Upgrade: a Workspace account or a transactional email service.
- **Postgres**: `orders` gains one row per order and nothing prunes it; the primary key keeps the gate’s lookup fast as it grows.

## Security: signatures, secrets, and untrusted text

Shopify’s webhook is the only way in from the internet. The backend binds, escapes, or writes raw every value from an order before it reaches SQL, HTML, or a sheet. Each control in detail:

- **Webhook signature**: The Shopify Trigger verifies `X-Shopify-Hmac-Sha256` against the raw body before any node runs. The client secret stays in the n8n credential, never in workflow JSON. The trigger compares with `!==`, which isn’t constant-time, and checks no timestamp, so anyone holding a captured delivery could replay it. The idempotency gate stops a replay at `Is new order?`.
- **Tunnel**: `ngrok/traffic-policy.yml` forwards only `^/webhook/4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d/webhook$`, matched on the raw, undecoded path. It denies any path that contains `%`, `\`, `//`, `/./`, or `/../`. Every other path gets a 404, including the editor, the REST API, and the dev harness. Compose publishes n8n’s own port on `127.0.0.1` only.
- **Dev harness**: `POST /webhook/dev` needs the `X-Dev-Token` header and is reachable from localhost only. `pnpm run setup` publishes it with the other sub-workflows, so unpublish it before production use.
- **Shopify scopes**: The token script asks for `read_orders`, `read_products`, and `read_inventory`, and rejects a token that lacks one or carries any other. The backend never changes orders, products, or stock; its only write is the trigger’s own `orders/create` subscription, created on activation and deleted on deactivation. The same scopes let anyone holding the token subscribe another address to `orders/create`, so the token is as sensitive as the order data.
- **Token handling**: The script reads the callback URL from stdin. It checks the callback’s HMAC the way Shopify’s `@shopify/shopify-api` library builds it, with a constant-time compare. It never prints the token, the code, or the client secret, and it writes `.env` atomically at mode 0600.
- **Customer data and retention**: Order webhooks carry the customer’s name, email, and address. n8n keeps them in execution data for 168 hours (7 days), then prunes them. The sheet keeps the name and city, not the email. Sent guides stay in the account’s Sent folder until someone deletes them.
- **Database**: The n8n role owns database `n8n`, and the app role owns database `app`. `REVOKE ALL … FROM PUBLIC` keeps each role out of the other’s database. The Postgres superuser only creates them, and n8n never gets its credentials. Every query passes values as `$n` parameters, and `pnpm run check` rejects a query built from an expression. It also rejects a `$n` inside a SQL comment. n8n replaces `$n` everywhere in the query text, so a value with a newline could end a `--` comment and run as SQL.
- **Formula injection**: `Upsert order row` writes cells as `RAW`, so a customer name such as `=HYPERLINK(…)` stays text.
- **Email**: The guide email escapes every dynamic value, from the first name to the guide text. The owner and error emails are plain text, and no email carries n8n’s attribution.
- **Theme**: The bar and the finder write only through `textContent`, never `innerHTML`. Liquid escapes every settings string and the store’s money format. The finder embeds product data as JSON in a `<script type="application/json">` tag, and Shopify’s `json` filter documents only quote escaping. So the section replaces `</` with `<\/` across the whole JSON, which `JSON.parse` reads back unchanged.
- **Honest storefront messages**: The finder says “Added to your cart.” only after a confirmed add: `updateCart` returned no `userErrors`, or the Cart AJAX fallback answered OK. A failure to open the cart drawer afterwards can’t turn that into an error. The bar logs one console warning when its markup lacks the parts its script fills. The finder does the same when an add can’t find its status or message element.
- **Secrets**: Secrets live only in `.env`, which git ignores, and in n8n’s credentials, encrypted with `N8N_ENCRYPTION_KEY`. `pnpm run setup` learns which credentials exist from an encrypted export and logs only names and IDs. CI runs gitleaks over the full history.
- **Files**: n8n’s file nodes can read only `/files` (`N8N_RESTRICT_FILE_ACCESS_TO`), where Compose mounts `config/` and `data/` read-only.

## Platform behaviors this design depends on

The pinned versions’ source, or a stored execution, confirms each behavior below:

- In n8n 2.45.6, a run started by a webhook calls only published sub-workflows.
- Postgres nodes need typeVersion 2.8 or later for free-text parameters. From 2.8, each `{{ }}` binds exactly one value; earlier versions split a text value on commas. A validator whose node list stops at 2.7 reports “typeVersion 2.8 exceeds maximum supported version 2.7”, a known false positive.
- An `INSERT … RETURNING` that returns no row still emits one `{ success: true }` item, because the statement isn’t a `SELECT`.
- n8n formats a Postgres query on the client, replacing `$n` everywhere in its text, comments included.
- A Read/Write Files read of a missing path returns zero items unless Always Output Data is on.
- A Wait shorter than `MAX_IN_PROCESS_WAIT_MS`, 65,000 ms, stays in process memory. n8n stores a longer one in the database, where the WaitTracker polls every 60 seconds.
- `/healthz` reports healthy before the publication reconciler syncs published versions, every 10 seconds by default. So `pnpm run setup` waits 15 seconds after its restart.
- An activation error reaches the Error Trigger with no `execution` key, only `trigger`.
- n8n runs a workflow’s error workflow when it fails as a sub-execution, not only as a top-level run. The only loop guard skips a run in error mode whose error workflow is itself. So a workflow that `error-handler` calls must not name `error-handler`.
- The GraphQL node throws on a response’s `errors` array and has no timeout setting.
- Google Sheets 4.7 keys an upsert on `columns.matchingColumns`, and finds a tab by name only in `name` mode.
- The Shopify Trigger manages its subscription through REST Admin API version `2024-07`, hard-coded. Shopify answers that retired version with its oldest supported one.
- `@shopify/theme-check-node`’s `check()` needs an absolute path; given a relative one, it silently checks nothing.

## Design decisions, each over its alternative

Each entry names a choice and the option it beat, then gives the reason:

- **Assembling Horizon from a pinned commit, over copying the theme into the repo**: The repo holds only its own files, three anchored insertions, and the commit hash. A diff then shows exactly what this store changes. An upgrade is one hash, and a moved anchor fails assembly instead of patching the wrong line.
- **The authorization code grant’s offline token, over client credentials**: An offline token lasts until someone uninstalls the app or revokes its secret ([offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens)). A client-credentials token lasts 24 hours, yet every trigger activation and every stock read needs a valid one. Client credentials stay as a fallback.
- **The Shopify Trigger’s built-in signature check, over a Webhook node plus a Crypto node**: Both keep the secret in a credential, and the trigger also manages its own subscription. The costs: it answers 200 on receipt, before `Record order`, so a crash in that window loses the order with no Shopify retry. It also needs a valid token at every start.
- **One GraphQL call, over the Shopify node**: The Shopify node reads orders and products but not metafields, and the guide needs each product’s brew method. One `nodes` query reads stock, tracking, and both metafields for every variant in the order.
- **The GraphQL node, over HTTP Request**: Shopify reports a throttle as HTTP 200 with a `THROTTLED` error, which HTTP Request treats as success. The GraphQL node throws on any `errors` array, so its retries cover throttling. The cost is the missing timeout setting, which a `NOTE:` on the canvas and the README’s Limitations record.
- **Three products with two sizes, over six products**: Size is a variant option, so each coffee has one page and one set of metafields, while each size keeps its own stock. The finder picks the size from the party size instead of choosing between near-identical products.
- **Append-or-update keyed on the order number, over append**: A repeated write updates the order’s row instead of adding a second one. That holds for the node’s own retries and for a retry from the executions list.
- **The bar’s math in TypeScript only, behind a morph-safe element, over computing it in Liquid as well**: Liquid renders only attributes and empty children, and one tested function computes the state and the message. `data-skip-subtree-update` keeps Horizon’s morph from wiping the rendered children. The morph still copies the new `data-total-cents`, which re-renders the bar.
- **`Shopify.actions` with a Cart AJAX fallback, over the Cart AJAX API alone**: `updateCart` adds through the platform, which lets Horizon’s drawer and the bar’s listener react, and `openCart` opens the drawer. If a page lacks it, the finder still adds through `/cart/add.js`.
- **A persisted Wait, over a scheduled job**: The order’s execution waits in Postgres and resumes with its own data, so there’s no queue table and no polling workflow. n8n persists only waits of 65 seconds or more, which is why `guide_delay_minutes` must be at least 2.
- **A primary-key gate in Postgres, over checking first**: One `INSERT … ON CONFLICT DO NOTHING` checks and records in a single statement. Two deliveries of one order can’t both pass, which a `SELECT` before an `INSERT` would allow. The cost is the lost-response row in the failure table.
- **Validating config in the order chain, over validating it in `load-config`**: `error-handler` loads the same config to find the owner’s address. A check inside `load-config` would make a bad hand edit silence its own alert. In `intake-order`, the check fails the run and the alert still goes out.
- **Loading config after the gate, over at the start of the entry**: A repeat stops before any config read, and a retry that resumes at or before the gate reads the file afresh. The cost: an order that fails at `Check config` is already recorded, so it needs its row deleted before a retry.
- **Code nodes built from TypeScript, over JavaScript written into the workflow JSON**: Each Code node is a pure, strictly typed, unit-tested function in `src/nodes/`. CI fails when the generated JSON is stale, and `pnpm run check` rejects a Code node that `scripts/lib/manifest.ts` doesn’t list.
- **A thin `shopify-orders` in front of `intake-order`, over one workflow**: A run started by a webhook calls only published workflows, and `shopify-orders` publishes only with the live Shopify credential. With the chain behind `intake-order`, the dev harness runs all of it offline. The cost: a failure in `intake-order` sends two alerts.

## Sources

The external pages cited above, each checked on 2026-11-01:

- Shopify, [troubleshooting webhooks](https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks): the 5-second timeout, up to 8 retries in 4 hours, and subscription removal.
- Shopify, [GraphQL Admin API rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), linked from [API limits](https://shopify.dev/docs/api/usage/limits): 100 to 2,000 points per second by plan, and 1,000 points per query.
- Shopify, [response codes](https://shopify.dev/docs/api/usage/response-codes): a throttle returns 200 with a `THROTTLED` error.
- Shopify, [API versioning](https://shopify.dev/docs/api/usage/versioning): a retired version falls forward to the oldest accessible one.
- Shopify, [get API access tokens](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens): client-credentials tokens expire after 24 hours, for apps and stores in one organization.
- Shopify, [offline access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens): non-expiring by default, and custom apps are exempt from the expiring-token rule.
- Shopify, [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data): levels 1 and 2 are always available to custom apps, with no review on development stores.
- Google, [Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits): 60 reads and 60 writes per minute per user per project, and 300 of each per project.
- Google, [Gmail sending limits](https://support.google.com/mail/answer/22839): more than 500 emails a day can stop a personal account from sending for 1 to 24 hours.
- Google, [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota): 6,000 quota units per minute per user, and 100 units per send.
