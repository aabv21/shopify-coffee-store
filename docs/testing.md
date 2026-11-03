# Test suites

This page lists every test suite in the repo: its command, what it covers, and how it stays deterministic and clean. It ends with what continuous integration (CI) actually runs.

## Unit and node tests (Vitest)

**Command:** `pnpm test` (`vitest run`, config `vitest.config.ts`). This is the one test command in the repo — there is no separate stack-test config or stack-only suite, because nothing here asserts against a live n8n, Postgres, or Shopify instance; the one script that does (`node scripts/check-dev-response.ts`) is a CLI run by hand or by CI's `n8n` job, not a Vitest file.

`vitest.config.ts` includes every `tests/**/*.test.ts` file under one run, with `tests/setup.ts` providing the ambient `DateTime` global the Code-node sandbox exposes at runtime, so a Code-node source under test sees the same global shape it would in n8n.

- **Code nodes** (`tests/nodes/*.test.ts`): `normalize-order.test.ts` (`Normalize order`, including that `customer_locale` becomes `locale`, normalized to `en`/`es`/`null`), `order-row.test.ts` (`Build order row`, the Bogotá-time conversion and the flattened sheet row), `owner-summary.test.ts` (`Build owner summary`, the owner email's subject and body in both `team_locale` values, with locale-aware digit grouping), `select-low-stock.test.ts` (`Select low-stock variants`, de-duplicating variants, failing loudly on a GraphQL error, and wording the alert in `team_locale`), `select-guides.test.ts` (`Build guide email`, picking one guide per matched brew method and writing it in the order's own locale, else `default_locale`, else English), and `error-alert.test.ts` (`Build error alert`, the error workflow's own locale handling: a missing or malformed `team_locale` falls back to English without throwing, since `error-handler` never validates its config). `tests/nodes/bundles.test.ts` runs every one of these sources through the same frozen-sandbox `jsCode` build `pnpm run build:workflows` produces, proving the committed workflow JSON and the Vitest-tested source stay the same code.
- **Config and locale** (`tests/config.test.ts`, `tests/lib/config.test.ts`, `tests/lib/locale.test.ts`): `config/config.example.json` carries every runtime key including `default_locale` and `team_locale`; `.env.example` lists every variable `compose.yaml`, `CREDENTIALS`, and the scripts actually read; `validateConfig` accepts an older config missing the locale keys and defaults both to `en`; `normalizeLocale` maps any tag (`es-CO`, `ES`, `en_US`, …) to `en` or `es` by its primary subtag, and anything unsupported to the given fallback.
- **Data** (`tests/data.test.ts`): `data/products.csv` has the three origins in two sizes with their planned prices, stock, and metafields; `data/brewing-guides.json` has one guide per brew method with a ratio and three short steps, each one translated into Spanish field-for-field with the same ratio.
- **Workflow hygiene and tooling** (`tests/hygiene.test.ts`, `tests/tooling/*.test.ts`, `tests/workflows.test.ts`): see "Workflow hygiene and tooling" below.
- **Scripts** (`tests/scripts/*.test.ts`): `check-db.test.ts` (the denial/grant/role-fact predicates and the one workflow statement `check-db` probes), `check-dev-response.test.ts` (`checksFor({ fresh })`'s predicate selection, including that the `es-CO` fixture's `locale` comes back `es`), `db-migrate.test.ts` (migration ordering, `\getenv` extraction, the transaction-control guard, the role-name-clash guard, and the password-logging guard), `init-env.test.ts` (`.env` generation against a fresh `mkdtempSync` directory), and `shopify-token.test.ts` (the authorization-code and client-credentials token exchanges, and that neither ever logs the client secret, the code, or the token).
- **Other library code** (`tests/lib/compose.test.ts`, `tests/lib/health.test.ts`): the Docker Compose wrapper (mocked `spawn`/`execFile`, including the stdin-error and spawn-error paths) and the `/healthz`/webhook-liveness polls.
- **Runtime and supply chain** (`tests/runtime.test.ts`, `tests/supply-chain.test.ts`, `tests/dev-client.test.ts`): `compose.yaml`'s pinned images, read-only mounts, and payload cap; the ngrok tunnel's traffic policy (the trigger-path allowlist regex, the rate limit, and `--inspect=false`); pnpm's effective supply-chain config (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `strictDepBuilds`, `engineStrict`), the exact pnpm 11 pin, the absence of `package-lock.json`, and that no tracked file still teaches a package command other than `pnpm`; and the dev-harness client (`callDev`), mocking `fetch` and `process.loadEnvFile` so no test depends on a real `.env` or a live stack.
- **Theme suites** (`tests/theme/*.test.ts`): see "Theme suites" below.

**Staying deterministic and clean:** no test in this suite opens a real network connection to n8n, Postgres, or Shopify — every script- or credential-facing test mocks `spawn`/`execFile`/`fetch` or reads a static fixture. `tests/scripts/init-env.test.ts` and the theme suites' own scratch directories are the exception to "no filesystem access," and both write under `mkdtempSync` or `.theme-build/`, a gitignored build directory, never the repo's tracked files.

## Workflow hygiene and tooling

Part of the same `pnpm test` run above, called out separately here because these tests don't exercise order-processing logic — they exercise the tools that keep the committed workflow JSON reviewable and reproducible.

- **`tests/hygiene.test.ts`** — asserts no tracked file references a plan, task, or ruling ID instead of stating its own reason.
- **`tests/tooling/build-workflows.test.ts`**, **`tests/tooling/check-workflows.test.ts`** — the Code-node build and the hygiene checker (`pnpm run check`), each run against `tests/fixtures/workflows/` (`clean.json` is a valid workflow; each other fixture is `clean.json` plus one defect: a bad credential ID, a missing `errorWorkflow` setting, a literal secret, a hand-written or undocumented Code node, a missing retry, a `$n` placeholder inside a SQL comment, and a missing sticky note).
- **`tests/tooling/credentials.test.ts`** — the credential-import plan (skip an existing credential unless `--refresh` names it, skip one with blank `.env` values).
- **`tests/workflows.test.ts`** — every committed workflow file's pinned node parameters, IF conditions, Postgres `typeVersion` (`2.8`), retry settings, and `errorWorkflow` wiring, so a hand edit to `workflows/*.json` that drifts from the generated or reviewed form fails here before it fails anywhere live.

**The commands these build and check tools exercise, which CI runs directly (not through a test file):**

- `pnpm run build:workflows -- --check` — fails if a Code node's committed `jsCode` doesn't match a fresh build of its `src/nodes/*.ts` source.
- `pnpm run check` — the hygiene checker against `workflows/` itself.

**Staying deterministic and clean:** every hygiene-check case runs against a static fixture file, never the live stack; `tests/fixtures/nodes/double.ts` is a one-line fixture Code-node source shared by the fixtures and tooling tests, so a build test never depends on a real `src/nodes/*.ts` file changing underneath it.

## Theme suites

Part of the same `pnpm test` run above. These need no Docker and no running stack: `pnpm run theme:assemble` (which they call internally) downloads the pinned Horizon commit over the network into `.theme-build/`, reusing it across runs, and everything else is pure TypeScript or liquidjs rendering.

- **`tests/theme/assemble.test.ts`** — the overlay (`added` vs. `modified`) and the insertions (anchor matching, the `InsertionError` on a missing file or a changed anchor), against `tests/fixtures/theme-base/` standing in for Horizon.
- **`tests/theme/brand.test.ts`** — `BRAND_SETTINGS`'s font handles against Shopify's font library list, and every brand color pair against WCAG AA.
- **`tests/theme/free-shipping.test.ts`**, **`tests/theme/recommend.test.ts`** — the free-shipping bar's progress math and the coffee finder's recommendation logic, both pure TypeScript.
- **`tests/theme/jsonc.test.ts`** — the JSON-with-comments reader used on Horizon's own locale files.
- **`tests/theme/money.test.ts`** — `formatMoney`'s whole-peso, period-grouped output.
- **`tests/theme/no-hardcoded-products.test.ts`** — the coffee finder section's Liquid never hardcodes a product handle, price, or title; every value comes from the catalog or the settings schema.
- **`tests/theme/theme-check.test.ts`** — `classifyOffenses` (an error anywhere, or any offense in a file this repo added or modified, is failing; everything else is Horizon's own baseline) and a real syntax error found through a relative theme directory, run via `@shopify/theme-check-node`'s own `check()`.
- **`tests/theme/preview.test.ts`** — the offline preview engine: the mock catalog parsed from `data/products.csv`, the free-shipping settings resolved the same way the insertion adds them, and both `sections/coffee-finder.liquid` and `snippets/free-shipping-bar.liquid` rendered with liquidjs in English and Spanish, asserting no English string leaks into the Spanish render.
- **`tests/theme/translations.test.ts`** — the theme's English and Spanish locale files carry the same `nubandina.*` keys, each non-empty, actually translated (not identical to English), with the same placeholders, and that the Liquid and editor schema reference exactly those keys.

**The commands these exercise, which CI runs directly:**

- `pnpm run build:theme -- --check` — fails if a theme asset's committed bundle doesn't match a fresh `esbuild` of its `src/theme/*` source.
- `pnpm run theme:check` — assembles the theme, then runs `@shopify/theme-check-node` against it, failing on any error or any offense in a file this repo touched.

**Staying deterministic and clean:** `tests/theme/assemble.test.ts` and `tests/theme/preview.test.ts` build against `tests/fixtures/theme-base/`, a tiny theme standing in for Horizon, not a real Horizon download, so those two files never depend on the network; `tests/theme/theme-check.test.ts`'s second case does download and reuses `.theme-build/horizon-<commit>/`, which `pnpm run theme:assemble` also populates and reuses, so this suite's first real run is the slow one. Every write happens under `.theme-build/`, which is gitignored and safe to delete.

## Diagrams

`docs/diagrams/architecture.json` and `docs/diagrams/order-sequence.json` have no automated test: they're typed JSON sources rendered by [archify](https://github.com/tt-a1i/archify), validated by hand with `archify validate` at `--quality showcase` and regenerated only when a workflow or theme change actually makes one of them stale. See `AGENTS.md`'s "Regenerate a diagram" for the exact commands.

## What CI runs

| CI job | What it runs |
|---|---|
| `quality` | `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` (the full Vitest suite above), `build:workflows -- --check`, `check`, `build:theme -- --check`, `theme:check`, then ShellCheck on every tracked `*.sh` file. |
| `security` | gitleaks in git mode over the full history, `pnpm audit --audit-level=high`. |
| `actions` | actionlint and zizmor against the workflow files themselves. |
| `n8n` | `node scripts/init-env.ts`, `cp config/config.example.json config/config.json`, `docker compose up -d --wait postgres n8n`, `pnpm run setup` (migrates, imports credentials, publishes workflows), `node scripts/check-db.ts`, `node scripts/check-dev-response.ts --fresh` (asserts the published `intake-order` chain actually runs, including that the fixture's `es-CO` locale comes back `es`), then `docker compose down -v` in an `if: always()` step. |
| `codeql` | `codeql.yml`, gated on the repository being public; not yet running against a private repo. |

**What's not automated, and why.** `pnpm run send-test-order` and the `--live` Shopify trigger need a real Shopify store and credential. `process-order`'s Google Sheets, Gmail, and Shopify GraphQL steps need Google and Shopify credentials CI doesn't have; `check-dev-response.ts` itself refuses to run at all if one already exists, so these stay a deferred, owner-present check (see [`README.md`](../README.md)'s "Live checks (pending)"). The queue-mode stack (`compose.queue.yaml`) is a manual, local check: scale `n8n-worker` and re-run `node scripts/check-dev-response.ts` against it, then return to the single-process stack.

## This repo's own Docker policy

Every suite above — including the full `pnpm test` run and both theme and workflow hygiene checks — runs with no Docker stack. Only `node scripts/check-dev-response.ts`, `node scripts/check-db.ts`, and `pnpm run send-test-order` need the local Compose stack (`postgres` and `n8n`) up first; none of them is a Vitest file, so `pnpm test` alone never starts a container.
