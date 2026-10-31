# Nubandina Coffee

**Demo**

A Shopify coffee store backed by a self-hosted n8n automation that turns each order into a recorded sale, an owner alert for low stock, and a brewing guide for the customer — all through a strict-TypeScript toolchain and a Docker-only local runtime.

## Status

Early build. The repository, toolchain, and local Docker runtime (n8n + Postgres) are in place. Workflows, the storefront theme, and the Shopify integration are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` all pass.
- Local Docker runtime: Postgres 17 and n8n 2.45.6, each reachable only on `127.0.0.1`.
- Database `app` (table `orders`) and database `n8n`, each owned by its own role; neither role can read the other's database.
- n8n's config and data mounts are read-only from inside the container.
- An optional ngrok tunnel (profile `tunnel`) that forwards only the Shopify order webhook's own path, built but not yet live-verified against a real tunnel.
- An optional queue mode (`compose.queue.yaml`) that adds Redis and scalable `n8n-worker` containers.

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
