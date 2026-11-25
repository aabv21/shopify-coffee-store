# AGENTS.md

Guidance for anyone, human or AI, working in this repository.

## What this repo is

This repo builds the order-processing backend for Nubandina Coffee, a fictional Shopify coffee store, plus its storefront theme. The backend is n8n workflows backed by Postgres. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Map

- `compose.yaml`, `compose.queue.yaml`, `.env.example`: the local runtime (Postgres, n8n, optional ngrok tunnel, optional queue mode).
- `db/`: the baseline schema, the one-time role bootstrap, and numbered idempotent `migrations/`.
- `ngrok/traffic-policy.yml`: the tunnel's policy; it forwards only the two Shopify Triggers' fixed paths.
- `config/config.example.json`: the config template. `config/config.json` is gitignored; `src/lib/config.ts` validates it.
- `data/`: `products.csv` (the Shopify import) and `brewing-guides.json` (English, with Spanish under `translations.es`).
- `workflows/`: the n8n workflow JSON, mounted read-only: `shopify-orders`, `intake-order`, `process-order`, `shopify-cancellations`, `cancel-order`, `reorder-reminder`, `load-config`, `error-handler`, `dev-harness`.
- `scripts/lib/manifest.ts`: the single source of truth for fixed IDs (`WORKFLOWS`, `CREDENTIALS`, `CODE_NODES`, `TRIGGER_WEBHOOK_ID`, `CANCEL_TRIGGER_WEBHOOK_ID`).
- `scripts/`: the CLIs behind Commands. `scripts/lib/` holds their shared helpers and the theme toolchain. In it, `theme-preview.ts`, `catalog.ts`, `color.ts` and `preview-css.ts` are the offline preview, and `theme-insertions.data.ts` is the data `theme-insertions.ts` applies.
- `src/nodes/`: Code-node sources; `email-shell.ts` is the branded HTML wrapper the emails share. `src/theme/`: the theme's TypeScript. `src/lib/`: shared pure helpers.
- `theme/`: the overlay onto Shopify's Horizon theme. `theme-locales/`: the theme's translation sources.
- `tests/`: Vitest tests, helpers, and fixtures.
- `.n8n-import/`, `.theme-build/`, `.lighthouse/`: generated and gitignored. Never `rm -rf` `.n8n-import/`.
- `docs/`: the documents below. `docs/shopify-setup.md` is the owner's manual store setup; nothing here runs it.
- `.github/`: CI (quality, security, actions, `n8n`, CodeQL) and Dependabot.

Where to read more:
- [`docs/architecture.md`](docs/architecture.md): components, the order flow, the [HTTP surface](docs/architecture.md#http-surface), data, failure modes with recovery, security, and design decisions.
- [`docs/database.md`](docs/database.md): the `app_runtime` role, migrations, retention, backup. [`docs/testing.md`](docs/testing.md): every suite and what CI runs.
- [`docs/operations.md`](docs/operations.md): running, changing, and checking the stack. [`docs/i18n.md`](docs/i18n.md): languages.
- [`docs/diagrams/README.md`](docs/diagrams/README.md): the diagrams and how to regenerate them.
- [`theme/README.md`](theme/README.md): the theme toolchain. [`CONTRIBUTING.md`](CONTRIBUTING.md): supply-chain settings and how to update dependencies.

## Commands

Details for each: [`docs/operations.md`](docs/operations.md).

- `pnpm install --frozen-lockfile`: install from the lockfile.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`: the three basic checks.
- `pnpm run build:workflows [-- --check]`: bundle `src/nodes/*.ts` into the Code nodes; `--check` fails on drift.
- `pnpm run check`: hygiene checks on every workflow.
- `pnpm run check:config`: validate `config/config.json`.
- `pnpm run db:migrate`: apply pending migrations.
- `pnpm run setup [-- [--live] [--refresh <id>]]`: migrate, import credentials, publish workflows.
- `pnpm run export`: write n8n's canonical workflow form back to `workflows/`.
- `pnpm run build:theme [-- --check]`, `pnpm run theme:assemble`, `pnpm run theme:check`, `pnpm run theme:preview [-- --locale es]`: the theme toolchain.
- `docker compose ls`: run it before starting the stack; every demo binds `127.0.0.1:5678`.
- `docker compose up -d --wait` and `docker compose down`: start and stop the stack (`down -v` wipes its data).

## Definition of done

- `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build:workflows -- --check && pnpm run check && pnpm run build:theme -- --check && pnpm run theme:check` all pass locally. Run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (What it does, Test scenarios with the live checks, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits.

## Branches, pull requests and releases

- `main` holds released code; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request from `develop` into `main` titled `release: vX.Y.Z`, merged with a merge commit. `.github/workflows/release.yml` then tags it and publishes the release, but only when the head branch is `develop` or `release/…`.
- Dependabot opens its pull requests against `develop`.
- In a pull request: the gate passes, test data is synthetic, docs reflect the change, the description lists what was verified and any deferred live checks, and the diff matches the description.

## Rules an agent must not break

1. Secrets live only in `.env` and n8n credentials; no script prints one.
2. Everything is English. Spanish appears only in `theme-locales/es*.json`, `translations.es` in `data/brewing-guides.json`, and the `{ en, es }` tables in `src/nodes/`.
3. Test data uses `example.com` emails, the `5700000000` phone prefix, and invented names.
4. Never hand-write a Code node: write `src/nodes/<name>.ts`, list it in `CODE_NODES`, and run `pnpm run build:workflows`.
5. Code-node sources are pure (no I/O, no clock) and use the ambient `DateTime`, not Luxon.
6. Every Postgres node stays at `typeVersion: 2.8`.
7. No Execute Workflow node sets `retryOnFail`.
8. A Postgres query's SQL comment never contains `$n`.
9. n8n's Postgres node connects only as `app_runtime`. A new statement needs its grant in a migration and a `PROBES` entry in `scripts/check-db.ts`.
10. Change a workflow through its JSON, then setup, export, and the round trip in [`docs/operations.md`](docs/operations.md).
11. `load-config` and `error-handler` never name an error workflow.
12. Keep the stock read on the GraphQL node, not HTTP Request.
13. `guide_delay_minutes` stays at 2 or more.
14. "Upsert order row" stays in `name` mode, and the Orders header row stays fixed ([`docs/shopify-setup.md`](docs/shopify-setup.md)).
15. Leave `--live` off unless you mean to accept real orders, and never run `setup -- --live` while orders are expected.
16. Before calling `intake-order` by hand, make sure no Google, Gmail, or Shopify credential exists.
17. Point tooling only at `http://localhost:5678`.
18. n8n stays on the `2.45` line, pinned by digest. Prose names the line, never the patch.
19. pnpm stays on its exact `11.x` pin. Never touch `minimumReleaseAge`, `trustPolicy`, or their excludes.
20. Never move `esbuild` past its pin, and keep `hardenAgainstFrozenDefineProperty` in `scripts/build-workflows.ts`.
21. Never `rm -rf .n8n-import`.
22. Theme components read only Horizon's CSS variables; brand values live in `BRAND_SETTINGS`.
23. Every theme string is a `nubandina.*` key in both storefront locales.
24. Never commit `.env`, `config/config.json`, or a `docs/diagrams/*.delivery.json` receipt.
25. A change to a component's look retakes its `docs/screenshots/` from the offline preview (`pnpm run theme:preview`; see [`docs/operations.md`](docs/operations.md)).
26. The reorder reminder goes out only when `buyer_accepts_marketing` is true; the brewing guide is part of the order.
27. A deliberate simplification gets one `NOTE:` comment naming its ceiling and its upgrade path.

Conventions behind these: Node 24 and ESM, strict TypeScript with native type stripping (no `.js` source, no build step), CLIs that call programs with an argument array and guard their entry point, and comments only where intent isn't obvious.

## Pointers

- Routes, auth, and statuses: [`docs/architecture.md#http-surface`](docs/architecture.md#http-surface).
- Recovery for a stuck or failed order: "Failure modes" in [`docs/architecture.md`](docs/architecture.md).
- The reasons behind the rules: "Security" and "Platform behaviors" in the same file.
- The theme toolchain, insertions, and translations: [`theme/README.md`](theme/README.md).
