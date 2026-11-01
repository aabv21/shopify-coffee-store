# Nubandina Coffee

**Demo**

A Shopify coffee store backed by a self-hosted n8n automation that turns each order into a recorded sale, an owner alert for low stock, and a brewing guide for the customer — all through a strict-TypeScript toolchain and a Docker-only local runtime.

## Status

Early build. The repository, toolchain, local Docker runtime (n8n + Postgres), the workflow tooling and CI, and the product catalog data are in place. The config loader, the shared error handler, and the offline dev harness are built and verified against the local n8n instance. Order intake (normalize, record once, hand off) is built and verified offline through the harness; the Shopify Trigger's own HMAC check is built but not yet verified against a live, published trigger. The core order-processing workflow, the storefront theme, and the live Shopify integration are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` all pass.
- Local Docker runtime: Postgres 17 and n8n 2.45.6, each reachable only on `127.0.0.1`.
- Database `app` (table `orders`) and database `n8n`, each owned by its own role; neither role can read the other's database.
- n8n's config and data mounts are read-only from inside the container.
- An optional ngrok tunnel (profile `tunnel`) that forwards only the Shopify order webhook's own path, built but not yet live-verified against a real tunnel.
- An optional queue mode (`compose.queue.yaml`) that adds Redis and scalable `n8n-worker` containers.
- Workflow tooling: `npm run check` (hygiene checks against the fixed manifest), `npm run build:workflows` (esbuild-bundles `src/nodes/*.ts` into Code-node `jsCode`, hardened against n8n's frozen-`Object.defineProperty` task runner), `npm run setup` (validates `config/config.json`, imports credentials, then publishes workflows — verified against the local n8n instance: it imports the credentials whose `.env` values are set, skips the rest with their reasons, and never prints credential data), and `npm run export` (writes n8n's canonical workflow JSON back to `workflows/`) — both verified idempotent on a second run (`git diff --exit-code workflows/` is clean).
- `npm run check:config` and the `validateConfig` it wraps (`src/lib/config.ts`): rejects a bad `owner_email`, Google Sheets ids/tab, Shopify store subdomain or API version, or an out-of-range `low_stock_threshold`/`guide_delay_minutes`, each with its own error message; accepts the example config as-is.
- Five workflows built, four published against the local n8n instance today: `load-config` (reads `/files/config/config.json` and returns `{ config }` unvalidated; a missing file fails the run loudly instead of returning nothing — verified by renaming the file and re-running the dev call below), `error-handler` (the shared error workflow: loads config and emails the owner a plain-text alert, with its fallback expressions structurally pinned to cover both a normal execution failure and a trigger failing at startup, which carries no `execution` data — sending a real email is a later, owner-present check), `dev-harness` (a token-protected, localhost-only webhook, routing to `load-config` and `intake-order` today), and `intake-order` (normalizes the order, records it once on `order_id`, loads and validates config, then hands off to the core order-processing workflow). The fifth, `shopify-orders` (the thin, credentialed entry point: the Shopify Trigger and a handoff), is only published with `--live`, so it stays off by default; `npm run setup` on its own correctly prints `skip publish shopify-orders.json (live trigger)`.
- `normalize-order` (`src/nodes/normalize-order.ts`), the Code node behind order intake: derives a stable `order_id` from `admin_graphql_api_id` (falling back to the order's own `id`), falls back to summing `shipping_lines` when Shopify's own shipping total is missing, treats a null or empty amount as missing rather than zero, and fails loudly (`Order payload has no id/order number/line items`, `Order payload has an invalid amount`) on a malformed payload — verified against five fixture orders covering a guest checkout with no email or addresses, a custom line item with no variant, a repeated variant, and every amount fallback and failure case.
- The idempotency gate, verified offline through the dev harness: `node scripts/dev-call.ts intake-order "$(cat tests/fixtures/orders/below-threshold.json)"` creates exactly one `orders` row and reaches as far as the (not-yet-built) core workflow; the identical call again creates no new row and stops cleanly at the gate, because the suppressed `INSERT ... ON CONFLICT DO NOTHING` reports a bare `{success: true}` with no `order_id` for a Postgres node to pass on.
- A localhost-only dev harness CLI (`node scripts/dev-call.ts`), gated by an `X-Dev-Token` header — verified end to end: `node scripts/dev-call.ts load-config '{}'` returns the mounted config, the same call against a renamed (missing) `config.json` fails loudly with a non-zero exit instead of returning an empty result, and `node scripts/dev-call.ts intake-order '<order json>'` shapes a raw order payload into one item the same way the Shopify Trigger would emit it before calling the published intake chain.
- CI (GitHub Actions): typecheck, lint, tests, workflow-build and hygiene checks, `npm audit`, ShellCheck, gitleaks, actionlint, and zizmor. CodeQL is wired up and activates once the repo is public.
- The product catalog (`data/products.csv`): 3 coffee origins (Nariño, Huila, Sierra Nevada) in 250 g and 500 g, with prices, stock, a Burst photo per product, and the `coffee` namespace metafields (roast, tasting notes, brew method) — verified offline against the catalog values and Shopify's public sample CSV's header spelling. `data/brewing-guides.json` holds one guide per brew method (pour-over, espresso, french press), each with a ratio and three short steps. `docs/shopify-setup.md` walks the owner through creating the dev store, the metafield definitions, the CSV import, shipping rates, and the test payment gateway — a manual, later step this repo doesn't automate.
- `npm run shopify:token [-- --client-credentials]`: builds and validates the Shopify Admin API access token exchange (authorize URL, signed-callback verification, form-encoded token requests, scope checking, atomic 0600 `.env` write) — tested offline against an injected `fetch`, never a real Shopify call. Getting the actual live token is a later, owner-present step (`docs/shopify-setup.md` "Admin API access").
- `npm run send-test-order [-- --fixture <name>] [--order-id <digits>] [--tamper]`: signs a fixture order exactly as Shopify signs a real webhook (HMAC-SHA256 of the raw body, base64) and posts it to the local Shopify Trigger — the signing, header-building, and tampering logic is unit-tested offline against the trigger's documented verification; actually sending a signed order against a running, live-published trigger is a later, owner-present check (see "Live checks (pending)" below).

## Quick start

```sh
cp .env.example .env
# fill the passwords and N8N_ENCRYPTION_KEY, e.g. with: openssl rand -hex 24
set -a; . ./.env; set +a

cp config/config.example.json config/config.json
mkdir -p .n8n-import workflows

docker compose up -d --wait
curl -s localhost:5678/healthz
```

n8n is then at <http://localhost:5678>.

## Limitations

Deliberate simplifications, each with its ceiling and upgrade path:

- **`intake-order` processes only the first order of a call.** `Process order`'s input reads `.first()` off `Normalize order`'s output, which is exact as long as a webhook call carries exactly one order, as it does today. A future caller that hands `intake-order` more than one item at once would still only process the first of them. Upgrade path: read the order from the current item (`.item`) instead of always taking the first one.
- **Shopify gets its HTTP 200 before the order is recorded.** The Shopify Trigger answers on receipt, before `Hand to intake` or anything inside `intake-order` runs. A failure past that point — a database outage, a bad hand-edited config — never shows up to Shopify as anything but success; it's visible only in n8n's own executions list, not in a delivery status.
- **A lost `Record order` response can strand an order with no alert.** If the INSERT actually commits but its response never reaches n8n before a retry runs, the retry's `ON CONFLICT DO NOTHING` suppresses it, reporting the same `{success: true}` a genuine duplicate would — so the order looks already handled even though nothing downstream of the gate ever ran. See `AGENTS.md`'s recovery steps.

## Live checks (pending)

These need a live, `--live`-published `shopify-orders` trigger with a real Shopify credential, so they aren't run yet:

- A valid order (`npm run send-test-order -- --fixture below-threshold --order-id <digits>`) produces one "Shopify orders" execution, one "Intake order" execution, and one `orders` row.
- The same order sent again produces another "Shopify orders" execution, but that run's "Intake order" stops at "Is new order?"; the `orders` row count doesn't change.
- A tampered signature (`npm run send-test-order -- --tamper --order-id <digits>`) gets HTTP 200, starts no execution at all, and creates no row.
- In one real order's execution data, every field `normalize-order` reads is present (`admin_graphql_api_id`, `name`, `email`, `shipping_address.name`/`city`, `line_items[].variant_id`/`variant_title`/`sku`, `total_shipping_price_set`, `shipping_lines`). If a field moved, update the fixture and the mapper.
