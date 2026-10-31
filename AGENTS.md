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
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n. Empty for now; later work adds and imports it.
- `src/nodes/` — Code-node sources for workflows (added with the workflows that need them). `src/theme/` — pure TypeScript modules behind the storefront theme. `src/globals.d.ts` declares the ambient `DateTime` global the n8n Code-node sandbox provides.
- `tests/` — Vitest tests; `tests/setup.ts` provides the `DateTime` global at test time, matching the sandbox.
- `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `package.json` — the TypeScript toolchain.
- `.n8n-import/` — created locally by the quick start; a scratch directory n8n's CLI reads credentials and workflows from. It's a live bind mount: never `rm -rf` it.

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

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step. It also includes `DOM` and `DOM.Iterable` in `lib`, since `src/theme/**` type-checks against the browser.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo is generated: `theme/assets/*.js` and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- No Code node is hand-written: each is `export function run(input) { ... }` in `src/nodes/<name>.ts` — pure, no I/O, no clock. Those sources use the ambient `DateTime` global (`src/globals.d.ts`) instead of importing Luxon, since the Code-node sandbox provides it but has neither `require` nor Node builtins, `fetch`, `window`, or `document`; ESLint enforces that in `src/nodes/**`. `src/theme/**` runs in the browser instead, so ESLint bans `process`, `Buffer`, and `require` there.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. No script prints a secret or a token.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo, including store content, theme defaults, emails, and sheet headers, is in English. No contact details anywhere.
- Database topology: role `$N8N_DB_USER` owns database `n8n`, role `$APP_DB_USER` owns database `app`, and neither can connect to the other's database (`REVOKE ALL ... FROM PUBLIC`). The Postgres superuser exists only to bootstrap those roles in `db/init/`; it is never configured in the n8n container.
- n8n is pinned to `2.45.6`; never move to an unstable `3.x` tag before one is stable.
- The tunnel forwards only the Shopify Trigger's own fixed webhook path. Every other path, including other `/webhook/…` paths, returns 404. Through the public ngrok URL (deferred live check, since it needs a real tunnel): `/`, `/rest/login`, `/webhook-test/x`, `/webhook/dev/x`, and `//webhook/x` each return 404, and only the trigger's own path reaches n8n.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.

## Definition of done

- `npm run typecheck && npm run lint && npm test` all pass locally — run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a branch named `task-NN-<slug>`.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches its task's brief — nothing extra, nothing missing.
