# Nubandina Coffee

**Demo**

A Shopify coffee store backed by a self-hosted n8n automation that turns each order into a recorded sale, an owner alert for low stock, and a brewing guide for the customer — all through a strict-TypeScript toolchain and a Docker-only local runtime.

## Status

Early build. The repository, toolchain, local Docker runtime (n8n + Postgres), the workflow tooling and CI, and the product catalog data are in place. The config loader, the shared error handler, and the offline dev harness are built and verified against the local n8n instance. The order-processing workflows, the storefront theme, and the live Shopify integration are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` all pass.
- Local Docker runtime: Postgres 17 and n8n 2.45.6, each reachable only on `127.0.0.1`.
- Database `app` (table `orders`) and database `n8n`, each owned by its own role; neither role can read the other's database.
- n8n's config and data mounts are read-only from inside the container.
- An optional ngrok tunnel (profile `tunnel`) that forwards only the Shopify order webhook's own path, built but not yet live-verified against a real tunnel.
- An optional queue mode (`compose.queue.yaml`) that adds Redis and scalable `n8n-worker` containers.
- Workflow tooling: `npm run check` (hygiene checks against the fixed manifest), `npm run build:workflows` (esbuild-bundles `src/nodes/*.ts` into Code-node `jsCode`, hardened against n8n's frozen-`Object.defineProperty` task runner), `npm run setup` (validates `config/config.json`, imports credentials, then publishes workflows — verified against the local n8n instance: it imports the credentials whose `.env` values are set, skips the rest with their reasons, and never prints credential data), and `npm run export` (writes n8n's canonical workflow JSON back to `workflows/`) — both verified idempotent on a second run (`git diff --exit-code workflows/` is clean).
- `npm run check:config` and the `validateConfig` it wraps (`src/lib/config.ts`): rejects a bad `owner_email`, Google Sheets ids/tab, Shopify store subdomain or API version, or an out-of-range `low_stock_threshold`/`guide_delay_minutes`, each with its own error message; accepts the example config as-is.
- Three workflows built and published against the local n8n instance: `load-config` (reads `/files/config/config.json` and returns `{ config }` unvalidated; a missing file fails the run loudly instead of returning nothing — verified by renaming the file and re-running the dev call below), `error-handler` (the shared error workflow: loads config and emails the owner a plain-text alert, with its fallback expressions structurally pinned to cover both a normal execution failure and a trigger failing at startup, which carries no `execution` data — sending a real email is a later, owner-present check), and `dev-harness` (a token-protected, localhost-only webhook, routing to `load-config` today).
- A localhost-only dev harness CLI (`node scripts/dev-call.ts`), gated by an `X-Dev-Token` header — verified end to end: `node scripts/dev-call.ts load-config '{}'` returns the mounted config, and the same call against a renamed (missing) `config.json` fails loudly with a non-zero exit instead of returning an empty result.
- CI (GitHub Actions): typecheck, lint, tests, workflow-build and hygiene checks, `npm audit`, ShellCheck, gitleaks, actionlint, and zizmor. CodeQL is wired up and activates once the repo is public.
- The product catalog (`data/products.csv`): 3 coffee origins (Nariño, Huila, Sierra Nevada) in 250 g and 500 g, with prices, stock, a Burst photo per product, and the `coffee` namespace metafields (roast, tasting notes, brew method) — verified offline against the catalog values and Shopify's public sample CSV's header spelling. `data/brewing-guides.json` holds one guide per brew method (pour-over, espresso, french press), each with a ratio and three short steps. `docs/shopify-setup.md` walks the owner through creating the dev store, the metafield definitions, the CSV import, shipping rates, and the test payment gateway — a manual, later step this repo doesn't automate.
- `npm run shopify:token [-- --client-credentials]`: builds and validates the Shopify Admin API access token exchange (authorize URL, signed-callback verification, form-encoded token requests, scope checking, atomic 0600 `.env` write) — tested offline against an injected `fetch`, never a real Shopify call. Getting the actual live token is a later, owner-present step (`docs/shopify-setup.md` "Admin API access").

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
