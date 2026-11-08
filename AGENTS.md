# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds the order-processing backend for Nubandina Coffee, a fictional Shopify coffee store, as an n8n workflow backed by Postgres, plus the storefront theme. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

- `compose.yaml`, `.env.example` — the local runtime: Postgres and n8n in Docker Compose, plus an optional ngrok tunnel (profile `tunnel`).
- `compose.queue.yaml` — an optional override that adds Redis and `n8n-worker` containers for queue mode; see Commands.
- `db/schema.sql`, `db/init/` — the baseline schema (table `orders`) and the one-time role and database bootstrap, both run only on an empty volume. `db/migrations/` holds every later change as an idempotent, numbered `NNN_short_name.sql`; see [`docs/database.md`](docs/database.md).
- `ngrok/traffic-policy.yml` — the tunnel's policy: it forwards only the Shopify Trigger's own fixed webhook path.
- `config/config.example.json` — the config template; a developer's `config/config.json` is gitignored. `src/lib/config.ts`'s `validateConfig` checks it; `default_locale` and `team_locale` (`en` or `es`) are optional and default to `en`.
- `data/products.csv` — the Shopify import CSV: 3 origins (Nariño, Huila, Sierra Nevada) in 250 g and 500 g, with the `coffee` metafields. Its headers and value formats come from Shopify's public sample CSV, since there is no store yet.
- `data/brewing-guides.json` — one guide per brew method, English at the top level and Spanish under `translations.es`. It's mounted read-only and live at `/files/data/`, so an edit applies on the next run with no re-import or restart.
- `docs/` — see the Documentation map below. `docs/shopify-setup.md` is the owner's manual store setup; nothing in this repo runs it.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n: `shopify-orders` (the Shopify Trigger plus a handoff), `intake-order` (normalize, record once, hand off), `process-order` (sheet row, emails, stock check, wait, brewing guide; input `{ order: NormalizedOrder, config: Config }`), `load-config`, `error-handler`, and `dev-harness`. [`docs/architecture.md`](docs/architecture.md) describes each.
- `scripts/lib/manifest.ts` — the single source of truth for fixed IDs (`WORKFLOWS`, `CREDENTIALS`, `CODE_NODES`, `TRIGGER_WEBHOOK_ID`). A `WORKFLOWS` entry's optional `webhookPath` is polled after publishing; only `dev-harness` sets it, and `shopify-orders` never may, since its trigger path must never be probed.
- `scripts/lib/` — also the workflow types, `normalizeWorkflow`, `listJsonFiles`, the Compose and `.env` helpers (`compose.ts`), the `/healthz` and webhook polls (`health.ts`), the dev-harness client (`dev-client.ts`), and the theme toolchain's `horizon.ts`, `theme-insertions.ts`, `jsonc.ts`, and `theme-preview.ts`.
- `scripts/*.ts` — the CLIs behind Commands below. `scripts/init-env.ts` writes `.env`; `scripts/check-dev-response.ts` is CI's proof that n8n executes a workflow.
- `src/nodes/` — Code-node sources. `src/theme/` — the storefront theme's TypeScript. `src/globals.d.ts` declares the sandbox's ambient `DateTime`.
- `theme/` — this repo's overlay onto Shopify's Horizon theme, plus `README.md`, which documents it and is never shipped. See "The theme toolchain" below.
- `theme-locales/` — the theme's translation sources: four partial locale files holding only the `nubandina` namespace. They live outside `theme/` because an overlay file at `locales/es.json` would replace Horizon's whole file.
- `tests/` — Vitest tests, helpers, and fixtures; [`docs/testing.md`](docs/testing.md) covers each.
- `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `package.json` — the TypeScript toolchain.
- `.n8n-import/` — created by `node scripts/init-env.ts`; a live bind mount that `pnpm run export` writes to (`.n8n-import/export`). Never `rm -rf` it; the tooling deletes only the files it writes. No credential data crosses it (see `IMPORT_SCRIPT` and `EXPORT_SCRIPT` in `scripts/setup-credentials.ts`). On Linux, it works only when the host uid matches n8n's container uid (1000).
- `.theme-build/` — gitignored, created by the theme toolchain: the cached Horizon download, the assembled theme, and the offline preview. Safe to delete.
- `docs/screenshots/` — retake them from the offline preview whenever a component's look changes.
- `.github/workflows/`, `.github/dependabot.yml` — CI (quality, security, actions-lint, and `n8n` jobs; CodeQL once the repo is public) and dependency updates.

## Documentation map

| Document | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Components, the order flow, the data model, failure modes (with recovery steps), scaling limits, security, and the design decisions behind each part. |
| [`docs/database.md`](docs/database.md) | The Postgres `app_runtime` role and its exact grant, migrations (`db/migrations/`, applied by `pnpm run db:migrate`), retention, backup and restore, connections, the upgrade path for an existing local volume, and what `node scripts/check-db.ts` proves. |
| [`docs/testing.md`](docs/testing.md) | Every test suite: its command, what it covers, and how it stays deterministic and clean, plus what CI actually runs. |
| [`docs/shopify-setup.md`](docs/shopify-setup.md) | The owner's manual, one-time steps for creating the dev store and importing the catalog: metafield definitions, currency format, the CSV import, shipping rates, the test payment gateway, and product image credits. |
| [`docs/screenshots/`](docs/screenshots/) | The storefront screenshots `README.md` and `theme/README.md` embed, taken from the offline preview at 390 × 844 and 1280 × 800, in English and Spanish. |
| [`theme/README.md`](theme/README.md) | The Horizon overlay and insertions model: assembly, the free-shipping bar, the coffee finder, the brand settings, and the translations namespace — never shipped to a store itself. |
| [`docs/diagrams/architecture.json`](docs/diagrams/architecture.json) | The system diagram's archify typed source (type `architecture`): storefront → Shopify → ngrok → `shopify-orders` → `intake-order` → `process-order` → Postgres, Google Sheets, Gmail. |
| [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) | The system diagram's interactive page, rendered by archify. Open it directly to read the diagram full-size, pan, and inspect each node. |
| [`docs/diagrams/architecture.svg`](docs/diagrams/architecture.svg) | The system diagram's exported image (`SVG · Auto`, follows the reader's light or dark theme), embedded in `docs/architecture.md`. |
| [`docs/diagrams/order-sequence.json`](docs/diagrams/order-sequence.json) | The order lifecycle sequence diagram's archify typed source (type `sequence`): delivery and HMAC check, the idempotency gate, config and hand-off, the sheet row and owner email, the stock check, the persisted wait, and the brewing guide. |
| [`docs/diagrams/order-sequence.html`](docs/diagrams/order-sequence.html) | The sequence diagram's interactive page. |
| [`docs/diagrams/order-sequence.svg`](docs/diagrams/order-sequence.svg) | The sequence diagram's exported image, embedded in `docs/architecture.md`. |

`docs/diagrams/*.delivery.json` receipts (one per diagram, written by `archify deliver`) hold local absolute paths and are gitignored; never force-add one.

## Commands

- `pnpm install --frozen-lockfile` — install dependencies from the lockfile.
- `pnpm run typecheck` — `tsc --noEmit`.
- `pnpm run lint` — `eslint .`.
- `pnpm test` — `vitest run`.
- `docker compose ls` — run this before starting the stack: every demo in this series binds `127.0.0.1:5678`, so stop any other demo's stack first.
- `docker compose up -d --wait` — start Postgres and n8n and wait until both are healthy.
- `docker compose --profile tunnel up -d --wait` — also start the ngrok tunnel (needs `NGROK_AUTHTOKEN` and `NGROK_DOMAIN`).
- `docker compose down` — stop the stack. Adding `-v` drops the named volumes, wiping the database and n8n's data.
- `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` — queue mode: Redis plus that many workers, which run executions instead of the main process. `n8n-worker` extends `compose.yaml`'s `n8n` with its published port reset, so it scales past one replica.
- `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait` — back to the single-process stack; plain `down` keeps the volumes.
- `pnpm run build:workflows [-- --check]` — bundles each `src/nodes/*.ts` into its Code node's `jsCode` and sets its `notes` to `Why Code: <why>`. `--check` exits 1 on drift without writing; CI runs it.
- `pnpm run check` — hygiene checks on every workflow (`scripts/check-workflows.ts`): pinned data, `meta.instanceId`, required settings (including `errorWorkflow: nbcErrorHandler1` everywhere except `error-handler` and `load-config`), literal emails, phones, long IDs, or secrets, unknown credential IDs, hand-written or undocumented Code nodes, missing retries, Postgres queries built from expressions or with `$n` inside a SQL comment, and a missing sticky note. `node scripts/check-workflows.ts <dir>` checks any directory.
- `pnpm run check:config` — runs `validateConfig` against `config/config.json`; prints `config OK` or the first error and exits non-zero.
- `pnpm run db:migrate` — applies each pending `db/migrations/` file in its own transaction, then resets `app_runtime`'s password and attributes from `.env`; a second run prints `no pending migrations`. Its guards and logging are in `docs/database.md` "Migrations".
- `pnpm run setup [-- [--live] [--refresh <id>]]` — validates the config first and stops on a bad one, then runs `db:migrate`, imports credentials, and publishes workflows. It skips a credential with blank `.env` values, or one that already exists unless `--refresh <id>` names it (repeatable), because re-importing drops an interactive Google sign-in. It skips a workflow not yet in `workflows/`. A `liveTrigger` workflow (`shopify-orders`) is published only with `--live`, so re-running without it after a live publish takes live order intake offline.
- `pnpm run export` — writes n8n's canonical form of every known workflow back to `workflows/` and regenerates the Code nodes; run it after editing in the n8n UI and commit the result.
- `node scripts/dev-call.ts <target> '<json>'` — calls the dev harness (`POST {N8N_URL}/webhook/dev`, needs `DEV_HARNESS_TOKEN`). Targets: `load-config` (`'{}'`) and `intake-order`, which takes a raw order fixture and runs the chain behind the trigger, bypassing the HMAC check: `node scripts/dev-call.ts intake-order "$(cat tests/fixtures/orders/below-threshold.json)"`. An unknown target answers 404.
- `pnpm run shopify:token [-- --client-credentials]` — gets the Admin API token for n8n's Shopify credential and writes `SHOPIFY_ACCESS_TOKEN` into `.env` at mode 0600. The default authorization code grant gives an offline token that doesn't expire. `--client-credentials`, for a same-organization dev store, gives a 24 h token, so re-run it daily, then `pnpm run setup -- --refresh nbcCredShopify01 --live`. See `docs/shopify-setup.md` "Admin API access".
- `pnpm run send-test-order [-- --fixture <name>] [--order-id <digits>] [--tamper]` — signs a fixture exactly as Shopify signs `orders/create` and posts it to the trigger's real path, exercising the HMAC check the dev harness bypasses. It reads `N8N_URL`, `SHOPIFY_STORE`, and `SHOPIFY_CLIENT_SECRET` from `.env`, never printed. Defaults: `below-threshold` and the current timestamp; `--tamper` changes the body after signing. Needs `shopify-orders` published with `--live`.
- n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` CLI commands need no owner account, `--userId`, or `--projectId` (checked against `2.45.6`). `publish:workflow` takes effect only after a restart, which `pnpm run setup` performs when it published something.
- `node scripts/init-env.ts` — writes `.env` from `.env.example`, filling only `POSTGRES_PASSWORD`, `N8N_DB_PASSWORD`, `APP_DB_PASSWORD`, `APP_RUNTIME_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, and `DEV_HARNESS_TOKEN` with random hex. It refuses to overwrite an existing `.env`. The quick start and CI both use it.
- `node scripts/check-db.ts` — proves `app_runtime`'s denials, exact grant, role facts, the one workflow statement (rolled back), and the migration ledger; prints `ok` or `FAIL` per check and exits 1 on any failure. See `docs/database.md` "Proving it".
- `node scripts/check-dev-response.ts [--fresh]` — refuses to run if a Google, Gmail, or Shopify credential exists in n8n; otherwise calls the harness's `load-config` and `intake-order` targets and asserts each response's shape, exiting 1 on a mismatch. `--fresh` (CI) accepts only the fresh-call shape, so a bug that makes every order a duplicate fails.
- `pnpm run theme:assemble` — builds the theme into `.theme-build/theme/` and prints the added and modified files. See "The theme toolchain" below.
- `pnpm run build:theme [-- --check]` — bundles `THEME_ENTRIES` (`scripts/build-theme.ts`) into `theme/assets/`, unminified. `--check` exits 1 on drift; CI runs it.
- `pnpm run theme:check` — assembles the theme and runs Shopify's theme check; exits 1 on any failing offense.
- `pnpm run theme:preview [-- --locale es]` — renders the real coffee finder and free-shipping bar with liquidjs and mock data into `.theme-build/preview/index.html`; a missing translation fails instead of falling back to English. Serve it with `python3 -m http.server 8765 --directory .theme-build/preview`. It's an approximation; `theme/README.md` lists every stub.
- Regenerate a diagram after editing its source in `docs/diagrams/`. The tool is [archify](https://github.com/tt-a1i/archify) (Node.js, no install), last checked against v3.2.0.

  Clone it outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run from the repo root, since each source's `meta.output` is relative to it. For the architecture diagram (type `architecture`):
  1. `node ../archify/archify/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --json`, after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
  2. `node ../archify/archify/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --json` writes the page, plus a gitignored `architecture.delivery.json` receipt.
  3. Open the page, choose **Export**, then **SVG · Auto**, and save over `docs/diagrams/architecture.svg`, which `README.md` and `docs/architecture.md` embed.
  4. Optionally, `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/architecture.html --json --out-dir ../archify-evidence` checks the page at four desktop sizes, with screenshots outside the repo.

  For the sequence diagram, run the same steps with type `sequence` and the `order-sequence` files; only `docs/architecture.md` embeds its SVG.

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real-world examples.
2. Edit the JSON in `workflows/` (IDs from `scripts/lib/manifest.ts`), then run `pnpm run build:workflows`.
3. Validate the JSON with an n8n-aware validator until it reports no errors. Ignore "typeVersion 2.8 exceeds maximum supported version 2.7" on a Postgres node: that validator stops at 2.7, and this repo pins 2.8 (see Conventions).
4. Run `pnpm run setup` to import and publish it locally, with `-- --live` once the Shopify credential is ready.
5. Run `pnpm run export` and commit its output, not your hand-edited JSON: the two can differ in server-assigned detail, and the exported form is what runs.
6. Run `pnpm run setup` and `pnpm run export` again, then `git diff --exit-code workflows/`. A non-empty diff means a field leaks instance state; add it to `scripts/lib/normalize-workflow.ts`'s volatile fields.
7. Run the full gate below before committing.

After any restart of the `n8n` container, wait 15 s past `/healthz` before calling a workflow: until the publication reconciler syncs (every 10 s by default), a call can still run the previous version. `pnpm run setup` waits this out itself.

## The theme toolchain

The storefront is Shopify's free Horizon theme at a pinned commit (`HORIZON` in `scripts/lib/horizon.ts`) plus this repo's overlay. `pnpm run theme:assemble` downloads Horizon, overlays `theme/`, and applies anchored edits, producing a complete theme at `.theme-build/theme/`. [`theme/README.md`](theme/README.md) documents the model in full.

- **Overlay.** Every file under `theme/` except `README.md` is copied onto the base: `added` if new to Horizon, `modified` if it replaces one.
- **Insertions.** `INSERTIONS` in `scripts/lib/theme-insertions.ts` makes the edits a whole-file overlay can't. Each names its file and an exact anchor, a key that must not exist yet, or each setting's current value; a mismatch throws `InsertionError` instead of editing the wrong place. A new storefront feature adds its own `THEME_ENTRIES` and `INSERTIONS` entries.
- **Brand.** The palette and fonts live in Horizon's settings (`BRAND_SETTINGS`, applied to `config/settings_data.json`), never in component CSS; components read only Horizon's CSS variables. Font handles are checked against Shopify's font library, and `tests/theme/brand.test.ts` holds every color pair to WCAG AA.
- **Theme check's gate is `failing: 0`.** An error anywhere fails, and so does any offense in a file this repo added or modified. Horizon's own baseline can drift between runs, so its count is printed, never asserted.
- **Translations.** Every string this repo adds is a `nubandina.*` key from `theme-locales/`, also copied in English into every other Horizon locale, since theme check reports a key missing from any of them as an error. Text settings have no defaults: `snippets/nubandina-text.liquid` prints the merchant's value, escaped, or else the translation.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM. `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `allowImportingTsExtensions` with `noEmit`, so there is no build step. Its `lib` includes `DOM` and `DOM.Iterable` for `src/theme/**`.
- No `.js` or `.mjs` source. Scripts are `scripts/*.ts`, run with `node scripts/<name>.ts` (native type stripping, no `tsx`); tests are `tests/**/*.test.ts`. The only JavaScript is generated: `theme/assets/*.js` and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import them without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- No Code node is hand-written: each is `export function run(input) { ... }` in `src/nodes/<name>.ts`, pure (no I/O, no clock), built by `pnpm run build:workflows` and listed in `CODE_NODES`. The sandbox has no `require`, Node builtins, `fetch`, `window`, or `document`, so these sources use the ambient `DateTime` instead of importing Luxon; ESLint enforces it. `src/theme/**` runs in the browser, so ESLint bans `process`, `Buffer`, and `require` there.
- Keep `hardenAgainstFrozenDefineProperty` in `scripts/build-workflows.ts`, which explains why it exists, and don't move `esbuild` past its exact pin without re-checking it. `tests/lib/code-node.ts` runs `jsCode` in the same frozen sandbox.
- Every Postgres node is pinned to `typeVersion: 2.8` (checked against `2.45.6`'s source; a test enforces it). Earlier versions split a comma inside a text parameter into extra bind values, and `order_number` is merchant-formatted text.
- No Execute Workflow node sets `retryOnFail: true` (the same test): a retry would repeat the sub-workflow's side effects.
- A Postgres query's SQL comments never contain `$n` (`pnpm run check` enforces it): n8n substitutes `$n` in the raw text, comments included, so a value with a newline could end a `--` comment and run as SQL. Document a parameter in the sticky note instead.

## Guardrails

- **Secrets** live only in `.env` (gitignored) and n8n credentials, never in code, workflow JSON, or committed config. No script prints a secret or a token: `setup-credentials.ts` detects existing credentials from an encrypted export and logs only names and IDs, and `shopify-token.ts` prints only the authorize URL, its prompts, and a final `Saved SHOPIFY_ACCESS_TOKEN (scopes: …; expires: …)` line; its errors carry the HTTP status and Shopify's error code, never the request body.
- **The Gmail credential (`nbcCredGmail0001`) is send-only.** `scripts/lib/manifest.ts` narrows it to `https://www.googleapis.com/auth/gmail.send`, so leave `senderName` unset on Gmail nodes (`tests/workflows.test.ts`). An existing stack needs `pnpm run setup -- --refresh nbcCredGmail0001` and a re-consent in the n8n editor, which should show only "Send email on your behalf". The old grant stays valid until revoked under the Google Account's [third-party access](https://myaccount.google.com/connections) page.
- **Test data** uses `example.com` emails, the `5700000000` phone prefix, and invented names. No contact details anywhere.
- **English everywhere** — store content, code, docs, keys, default strings, and sheet headers. Spanish appears only in `theme-locales/es*.json`, `data/brewing-guides.json`'s `translations.es`, and the `{ en, es }` message tables of the email Code nodes.
- **Database roles.** n8n's Postgres node connects only as `app_runtime` (`SELECT, INSERT` on `orders`). The superuser and `$APP_DB_USER` are never configured in the n8n container, and neither database owner can reach the other's database. See `docs/database.md`.
- **n8n is pinned to `2.45.6`.** Never move to an unstable `3.x` tag. Dependabot skips minor and major `n8nio/n8n` bumps, because beta and stable releases share plain semver tags.
- **The tunnel forwards only the Shopify Trigger's fixed path;** every other path returns 404. Deferred live check through the public URL: `/`, `/rest/login`, `/webhook-test/x`, `/webhook/dev/x`, and `//webhook/x` each return 404.
- **The dev harness is localhost-only** (`X-Dev-Token`, credential `nbcCredDevToken1`, env `DEV_HARNESS_TOKEN`) and has no public route, by the tunnel policy. It calls its target with no retry. `pnpm run setup` publishes it, so unpublish it by hand before any production use.
- **Calling `intake-order` through the harness also starts `process-order`**, which reaches Google Sheets, Gmail, and Shopify. `check-dev-response.ts` refuses when such a credential exists; before running `node scripts/dev-call.ts intake-order` by hand, check the same way, or a stack wired to real accounts sends real emails and writes a real sheet row.
- **Leave `--live` off unless you mean to accept real orders.** And don't run `pnpm run setup -- --live` while orders are expected: re-importing `shopify-orders` deletes and recreates its Shopify subscription, and an order placed in between never arrives.
- Point tooling only at this repo's local n8n instance (`http://localhost:5678`), never another instance.
- **A missing or unparseable `config/config.json` also silences the error alert,** because `error-handler` loads the same file. Only n8n's executions list shows it. Fix the file (`pnpm run check:config`), then recover each order as below.
- **`SHOPIFY_STORE` in `.env` and `config.shopify.store` must name the same store.** Nothing cross-checks them, and the stock read authenticates with one and builds its URL from the other, so a mismatch fails it (`error-handler` email).
- **Keep the stock read on the GraphQL node, not HTTP Request.** Shopify reports throttling as HTTP 200 with an `errors` array; only the GraphQL node throws on it, so its retries apply. The trade-off is no request timeout (README's Limitations).
- **`guide_delay_minutes` must stay at 2 or more.** n8n 2.45.6 keeps a wait under 65 s (`MAX_IN_PROCESS_WAIT_MS`) in memory, where a restart loses it.
- **The Orders tab must match `config.google.orders_tab` exactly, with a header row** `date | order_number | customer | city | products | units | subtotal | shipping | total | free_shipping` (`docs/shopify-setup.md`). "Upsert order row" must stay in `name` mode, the only one that resolves a tab name from an expression.
- **The intake split.** A webhook-started run can call only published workflows, and `shopify-orders` publishes only with the live credential. So it holds just the trigger and a handoff, and `intake-order` holds the rest, which publishes and runs offline.
- **Shopify gets its 200 before anything is recorded** (the trigger's `responseMode` is `onReceived`), and a failed HMAC check also gets a 200 with no execution. A wrong or rotated `SHOPIFY_CLIENT_SECRET` therefore drops every order silently; `docs/architecture.md` "Failure modes" has the recovery.
- **A failed order alerts twice,** once for `intake-order` and once for `shopify-orders`, which waits on it.
- **Recovering an order stuck at the idempotency gate.** A duplicate and a lost INSERT response both return a bare `{success: true}`. Check `SELECT * FROM orders WHERE order_id = '<id>'`: rebuild a real order's sheet row and emails by hand; for a test order, delete the row and re-send it.
- **Recovering an order that passed the gate and then failed:** fix the cause, delete the order's `orders` row, then retry the failed `shopify-orders` execution, not `intake-order`'s, which would replay the config it already loaded.

## Languages

The store speaks English (`en`) and Spanish (`es`). English is the source language for code, docs, keys, and default strings. Spanish copy is neutral Latin American Spanish in a Colombian business register: *usted* for customers, natural phrasing rather than word-for-word, correct accents and `¿`/`¡`.

- **One locale helper.** `normalizeLocale(value, fallback)` in `src/lib/locale.ts` maps any tag (`es-CO`, `es_CO`, `ES`, `en-US`, …) to `en` or `es` by its primary subtag, else to `fallback`. Every Code node that picks a language uses it.
- **Customer emails.** `Normalize order` carries `customer_locale` as `locale` (`en`, `es`, or `null`). `Build guide email` uses it, else `config.default_locale`, else English. Shopify documents `customerLocale` as nullable, with values such as `en`, `fr-CA`, and `es-MX` ([Order object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)).
- **Owner emails.** `Build owner summary`, `Select low-stock variants`, and `Build error alert` use `config.team_locale`, with the locale's digit grouping (`96,000 COP`, `96.000 COP`). `Build error alert` never throws on a bad locale; if it fails anyway, `Email owner` sends a short English alert from the trigger data.
- **Older configs and in-flight runs.** Each Set node passes a missing locale as `''`, which the Code node reads as the default. A waiting execution resumes on the workflow version it started with, so `data/brewing-guides.json` keeps English at the top level.
- **Storefront.** See "Translations" above and `theme/README.md`. Product content is store data, translated in Shopify's Translate & Adapt app (a deferred live check).
- **Completeness.** `tests/theme/translations.test.ts`, `tests/data.test.ts`, and `tests/theme/preview.test.ts` hold both languages to the same keys and placeholders, with no English left in the Spanish render.

**Switching languages.** Set `default_locale` and `team_locale` in `config/config.json` (`pnpm run check:config` validates them). The storefront follows the visitor's language as Shopify selects it; publish Spanish under Settings > Languages.

**Adding a language** (for example `pt-BR`, normalized to `pt`):
1. Add its code to `LOCALES` in `src/lib/locale.ts`; every `Record<Locale, …>` message table in `src/nodes/` then fails to compile until it has an entry.
2. Add those entries in `select-guides.ts`, `owner-summary.ts`, `select-low-stock.ts`, and `error-alert.ts`, and `translations.<code>` to every guide in `data/brewing-guides.json`.
3. Add `theme-locales/<tag>.json` and `<tag>.schema.json` with every English key, and point that locale's insertions in `scripts/lib/theme-insertions.ts` at them.
4. Extend `tests/theme/translations.test.ts` and `tests/data.test.ts`, then run `pnpm run build:workflows` and the full gate.

## Supply-chain hardening

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x`; never move to pnpm 12, whose default lockfile Dependabot can't parse yet. `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320` — no package version (transitive included) younger than 3 days, so a compromised release can be pulled first.
- `minimumReleaseAgeExclude: []` — replaces pnpm 11's default `n8n`/`n8n-*`/`@n8n/*` exemption, so nothing is exempt.
- `trustPolicy: no-downgrade` — an install fails if a package's provenance or trusted publishing regresses, or if the pinned pnpm itself would downgrade it.
- `blockExoticSubdeps: true` — only a direct dependency may come from a git or tarball URL.
- `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false` — an install script fails the install unless `allowBuilds` approves it.
- `engineStrict: true` — a dependency whose `engines` excludes this Node fails the install.
- `allowBuilds` — only packages a real `pnpm install --frozen-lockfile` proved need a build script, each with a one-line reason. Today that's only `esbuild`, whose postinstall links its platform binary; the theme toolchain needs none.

`tests/supply-chain.test.ts` checks these through `pnpm config list --json`, pnpm's effective config, plus the exact pnpm 11 pin, no `package-lock.json`, no tracked file teaching an `npm` command, and a `@sha256:` digest on every image.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`), run the gate, and commit both files. If `minimumReleaseAge` refuses a version, wait it out or pin an older one; don't work around it.

**Landing a security fix younger than 3 days:**
1. Add a temporary `minimumReleaseAgeExclude` entry for that exact version (`"esbuild@0.28.3"`, never the bare name, which exempts every future version), with a `#` comment naming the advisory ID and today's date.
2. Run `pnpm install` and merge as usual.
3. Remove the entry once the version is older than 3 days.

The supply-chain test goes red at step 1 on purpose, as the reminder for step 3; let it stay red for that PR rather than weakening it. If that makes CI unmergeable, wait out the 3 days instead.

**Images** in `compose.yaml` and `compose.queue.yaml` are pinned `name:tag@sha256:<digest>`, the multi-arch index digest from `docker buildx imagetools inspect name:tag`, so one reference works on arm64 (local) and amd64 (CI). Dependabot refreshes an existing digest but won't add one, so a tag bump needs the digest re-resolved and the tag reviewed by hand.

**CI** installs with `pnpm/setup` (pinned by SHA), `actions/setup-node` with `cache: pnpm`, `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level=high`. Its own `docker run` images (`koalaman/shellcheck`, `zricethezav/gitleaks`, `rhysd/actionlint`) are digest-pinned too, and zizmor installs from `.github/zizmor-requirements.txt` with `--require-hashes`. Dependabot doesn't track `run:` lines, so bump these by hand, re-resolving the digest or hashes in the same PR. `docs/testing.md` "What CI runs" covers each job, including the `n8n` job that boots the stack.

**Dependabot** adds a 7-day cooldown to every ecosystem: `npm` (which covers the pnpm lockfile) gets 14 days for major and 7 for minor and patch; `docker-compose` and `github-actions`, with no semver convention, get a flat 7. Every version PR is therefore already past pnpm's 3-day gate. Security updates skip the cooldown.

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green, and repository rulesets block direct pushes, force pushes, and deletion.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request from `develop` into `main`, merged with a merge commit, then tagged `vX.Y.Z` with a GitHub release.
- Dependabot opens its pull requests against `develop`.

## Definition of done

- `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build:workflows -- --check && pnpm run check && pnpm run build:theme -- --check && pnpm run theme:check` all pass locally — run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches what the PR description says: nothing extra, nothing missing.
