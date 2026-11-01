# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds the order-processing backend for Nubandina Coffee, a fictional Shopify coffee store, as an n8n workflow backed by Postgres, plus the storefront theme. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

- `compose.yaml`, `.env.example` — the local runtime: Postgres and n8n in Docker Compose, plus an optional ngrok tunnel (profile `tunnel`).
- `compose.queue.yaml` — an optional override that adds Redis and `n8n-worker` containers for queue mode; see Commands.
- `db/schema.sql`, `db/init/` — the application database schema (table `orders`) and the one-time role/database bootstrap script.
- `ngrok/traffic-policy.yml` — the tunnel's traffic policy: forwards only the Shopify Trigger's own fixed webhook path, denying every other path, including other webhook-shaped ones.
- `config/config.example.json` — the config template; a developer's own `config/config.json` is gitignored.
- `data/products.csv` — the Shopify product import CSV: 3 coffee origins (Nariño, Huila, Sierra Nevada) in 250 g and 500 g, with the `coffee` namespace metafields (roast, tasting notes, brew method). Header spelling and value formats (`Active`, `TRUE`/`FALSE`, `DENY`) come from Shopify's public sample CSV, not a store download — there is no store yet. `data/brewing-guides.json` — one brewing guide per brew method (pour-over, espresso, french press), mounted into n8n at `/files/data/brewing-guides.json` for the guide-email workflow a later task adds.
- `docs/shopify-setup.md` — the owner's step-by-step guide for creating the dev store and importing the catalog: metafield definitions, currency format, the CSV import, shipping rates, the test payment gateway, and the product image credits. Manual; nothing in this repo runs it.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n. Empty for now; Tasks 5-9 add and import it.
- `scripts/lib/manifest.ts` — the single source of truth for fixed workflow/credential/code-node IDs (`WORKFLOWS`, `CREDENTIALS`, `CODE_NODES`, `TRIGGER_WEBHOOK_ID`); `scripts/lib/` also holds the workflow types, `normalizeWorkflow`, `listJsonFiles`, the Docker Compose and `.env` helpers (`compose.ts`), the `/healthz` poll (`health.ts`), and the dev-harness client (`dev-client.ts`).
- `scripts/check-workflows.ts`, `scripts/build-workflows.ts`, `scripts/export-workflows.ts`, `scripts/import-workflows.ts`, `scripts/setup-credentials.ts`, `scripts/setup.ts`, `scripts/dev-call.ts` — the workflow tooling CLIs; see Commands below.
- `src/nodes/` — Code-node sources for workflows (added with the workflows that need them). `src/theme/` — pure TypeScript modules behind the storefront theme. `src/globals.d.ts` declares the ambient `DateTime` global the n8n Code-node sandbox provides.
- `tests/` — Vitest tests; `tests/setup.ts` provides the `DateTime` global at test time, matching the sandbox. `tests/lib/code-node.ts` runs a generated Code node's `jsCode` the way n8n's real Task Runner sandbox does (`Object.defineProperty` replaced with a no-op before the code runs). `tests/fixtures/workflows/` holds the hygiene-check fixtures: `clean.json` is a valid workflow, each other file is `clean.json` plus one defect.
- `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `package.json` — the TypeScript toolchain.
- `.n8n-import/` — created locally by the quick start; a scratch directory n8n's CLI reads credentials and workflows from. It's a live bind mount: never `rm -rf` it; the tooling only ever deletes the specific files it writes there.
- `.github/workflows/`, `.github/dependabot.yml` — CI (quality, security, actions lint jobs; CodeQL once the repo is public) and automated dependency updates.

## Commands

- `npm ci` — install dependencies from the lockfile.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — `eslint .`.
- `npm test` — `vitest run`.
- `docker compose ls` — list running Compose stacks; run this before starting the stack, since every demo in this series binds `127.0.0.1:5678`. Stop any other demo's stack first.
- `docker compose up -d --wait` — start Postgres and n8n, and wait for both to report healthy.
- `docker compose --profile tunnel up -d --wait` — also start the ngrok tunnel (needs `NGROK_AUTHTOKEN` and `NGROK_DOMAIN`).
- `docker compose down` — stop the stack. Add `-v` to also drop the named volumes (destructive: wipes the database and n8n's data).
- `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` — switch to queue mode: adds Redis and the given number of `n8n-worker` containers, which run executions instead of the main process. `n8n-worker` extends `compose.yaml`'s own `n8n` service (same encryption key, database settings, and read-only `/files` mounts), with its published port reset so it scales past one replica without a conflict.
- `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait` — return to the regular, single-process stack. Plain `down`, with no `-v`, keeps the named volumes.
- `npm run build:workflows` — bundles each `src/nodes/*.ts` Code node with esbuild into its node's `jsCode`, and sets its `notes` to `Why Code: <why>`. Add `-- --check` to fail (exit 1) if the committed JSON doesn't match the source, without writing — that's what CI runs.
- `npm run check` — hygiene checks on every file in `workflows/`: pinned data, `meta.instanceId`, required settings, a literal email/phone/long-id/secret, an unknown credential id, a hand-written or undocumented Code node, an external-service node without the required retry, a Postgres query built from an expression instead of `$n` parameters, and a missing sticky note. `node scripts/check-workflows.ts <dir>` runs it against any directory and prints `<file>: <message>` per violation.
- `npm run setup` — imports credentials (`scripts/setup-credentials.ts`) then publishes workflows (`scripts/import-workflows.ts`) into the local n8n instance, in that order (`node scripts/setup.ts`, not `a && b`, so `-- --live`/`-- --refresh <id>` flags reach both steps). Skips a credential whose `.env` values are blank, or one that already exists unless named with `--refresh <id>` (any number of times) — re-importing a credential replaces it, which would otherwise drop an interactive Google sign-in. Skips a workflow not yet in `workflows/`. **A `liveTrigger` workflow (`shopify-orders.json` today) is only published with `--live`** — `npm run setup` on its own leaves the Shopify trigger unpublished, so running it again after a live publish (for example, to refresh a credential) takes the store's live order intake offline unless `--live` is passed again.
- `npm run export` — writes n8n's canonical form of every known workflow back to `workflows/` and regenerates their Code nodes; run this after editing a workflow in the n8n UI, and commit the result.
- `node scripts/dev-call.ts <target> '<json>'` — calls the dev-harness webhook (`POST {N8N_URL}/webhook/dev`) directly, for exercising a sub-workflow without a real Shopify order. See Guardrails below; its own workflow (`dev-harness.json`) lands in Task 5.
- `npm run shopify:token [-- --client-credentials]` — gets the Admin API access token for n8n's Shopify credential (`docs/shopify-setup.md` "Admin API access"). By default it runs Shopify's authorization code grant: it prints an authorize URL, reads the resulting callback URL from stdin, and exchanges the code for an offline token that doesn't expire. `--client-credentials` is the fallback for a same-organization dev store: a token that expires in 24 h, which then needs `npm run shopify:token -- --client-credentials` and `npm run setup -- --refresh nbcCredShopify01 --live` re-run daily (the `--live` matters; see `npm run setup` above). Either way it writes `SHOPIFY_ACCESS_TOKEN` into `.env`, keeping the file at mode 0600.
- n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` CLI commands need no owner account, `--userId`, or `--projectId` (checked against `2.45.6`). `publish:workflow` only takes effect after an n8n restart; `npm run setup` restarts n8n itself, but only when it actually published something, then waits for `/healthz` and an extra 15 s (see "Changing a workflow" below).

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real-world examples.
2. Edit the JSON in `workflows/` (fixed IDs and credential IDs come from `scripts/lib/manifest.ts`), then run `npm run build:workflows` to regenerate any Code node it touches.
3. Validate the workflow JSON with an n8n-aware validation tool until it reports no errors.
4. Run `npm run setup` to import and publish it against the local n8n instance. Add `-- --live` once the Shopify trigger's credential is ready — without it, `shopify-orders.json` stays unpublished (see Commands).
5. Run `npm run export` to write n8n's canonical form back to `workflows/` and regenerate Code nodes again. Commit that exported output, not your hand-edited JSON — the two can differ in server-assigned detail, and the exported form is what actually runs.
6. Run `npm run setup` and `npm run export` a second time, then `git diff --exit-code workflows/` — a clean diff confirms import and export stay idempotent; a non-empty one means a field is leaking the instance's own state into the committed JSON (extend `scripts/lib/normalize-workflow.ts`'s volatile-fields list).
7. Run the full gate below before committing.

A call made right after `npm run setup` restarts n8n can still run the previous published version for a few seconds: `/healthz` reports healthy well before the publication reconciler syncs `workflow_published_version` to the active version, which it does on its own schedule (10 s by default). `npm run setup` waits 15 s past `/healthz` for exactly this reason; after any other restart of the `n8n` container, wait the same before calling a workflow.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step. It also includes `DOM` and `DOM.Iterable` in `lib`, since `src/theme/**` type-checks against the browser.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo is generated: `theme/assets/*.js` and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- No Code node is hand-written: each is `export function run(input) { ... }` in `src/nodes/<name>.ts` — pure, no I/O, no clock — compiled by `npm run build:workflows`; `npm run check` rejects any Code node not listed in `scripts/lib/manifest.ts`'s `CODE_NODES`. Those sources use the ambient `DateTime` global (`src/globals.d.ts`) instead of importing Luxon, since the Code-node sandbox provides it but has neither `require` nor Node builtins, `fetch`, `window`, or `document`; ESLint enforces that in `src/nodes/**`. `src/theme/**` runs in the browser instead, so ESLint bans `process`, `Buffer`, and `require` there.
- n8n's Code-node Task Runner (`@n8n/task-runner`) runs generated `jsCode` after setting `Object.defineProperty = () => ({})`, a sandbox hardening measure. esbuild's own IIFE output attaches every named export through that same function, so without a fix every export would silently vanish and `__node.run` would come back `undefined` — see `scripts/build-workflows.ts`'s `hardenAgainstFrozenDefineProperty`, covered by a dedicated test that simulates the frozen sandbox (`tests/lib/code-node.ts`'s `runJsCode` freezes the same way). Don't remove it when touching the build, and don't upgrade `esbuild` past its exact pin in `package.json` without re-checking this patch still applies to its codegen.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. No script prints a secret or a token: `setup-credentials.ts` detects which credentials already exist in n8n from a CLI export, never a decrypted one, and only ever logs a credential's name and id, never its `data`. `shopify-token.ts` never prints the client secret, the authorization code, or the access token; its only output is the authorize URL, its prompts, and the final `Saved SHOPIFY_ACCESS_TOKEN (scopes: …; expires: …)` line, and an error message carries the HTTP status and Shopify's error code, never the request body.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo, including store content, theme defaults, emails, and sheet headers, is in English. No contact details anywhere.
- Database topology: role `$N8N_DB_USER` owns database `n8n`, role `$APP_DB_USER` owns database `app`, and neither can connect to the other's database (`REVOKE ALL ... FROM PUBLIC`). The Postgres superuser exists only to bootstrap those roles in `db/init/`; it is never configured in the n8n container.
- n8n is pinned to `2.45.6`; never move to an unstable `3.x` tag before one is stable. Dependabot's automated updates for `n8nio/n8n` exclude minor and major bumps, because beta and stable releases share plain semver tags.
- The tunnel forwards only the Shopify Trigger's own fixed webhook path. Every other path, including other `/webhook/…` paths, returns 404. Through the public ngrok URL (deferred live check, since it needs a real tunnel): `/`, `/rest/login`, `/webhook-test/x`, `/webhook/dev/x`, and `//webhook/x` each return 404, and only the trigger's own path reaches n8n.
- **The dev harness** (`node scripts/dev-call.ts`, `scripts/lib/dev-client.ts`) is **localhost-only**: it calls `${N8N_URL}/webhook/dev` directly and is gated by an `X-Dev-Token` header (credential `nbcCredDevToken1`, env `DEV_HARNESS_TOKEN`). Its workflow (`dev-harness.json`, Task 5) is **never exposed through the ngrok tunnel** — `ngrok/traffic-policy.yml` forwards only the Shopify Trigger's own fixed path, so the harness has no public route by construction — and must stay **unpublished before any production use**. `npm run setup` without `--live` is exactly the state to leave it in day to day (see "Changing a workflow" above): the harness is a build-time and demo tool, not part of the live order path.
- `npm run setup` without `--live` leaves any `liveTrigger` workflow (`shopify-orders.json`) unpublished, deliberately: the local default never turns on live Shopify order intake by accident. Pass `--live` only when you mean to accept real orders.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.

## Definition of done

- `npm run typecheck && npm run lint && npm test && npm run build:workflows -- --check && npm run check` all pass locally — run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a branch named `task-NN-<slug>`.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches its task's brief — nothing extra, nothing missing.
