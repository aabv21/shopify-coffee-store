# Running and operating the stack

The commands for starting, changing, and checking the local stack. [`AGENTS.md`](../AGENTS.md) lists each command in one line; this page holds the details. For what each part does, see [`architecture.md`](architecture.md).

## Start and stop

Run `docker compose ls` first. Every demo in this series binds `127.0.0.1:5678`, so stop any other demo's stack before you start this one.

- `docker compose up -d --wait` starts Postgres and n8n and waits until both are healthy.
- `docker compose --profile tunnel up -d --wait` also starts the ngrok tunnel. It needs `NGROK_AUTHTOKEN` and `NGROK_DOMAIN`.
- `docker compose down` stops the stack. Adding `-v` drops the named volumes, which wipes the database and n8n's data.

**Queue mode.** `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` adds Redis and that many workers, which run executions instead of the main process. `n8n-worker` extends `compose.yaml`'s `n8n` with its published port reset, so it scales past one replica. To go back to the single-process stack, run `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait`. A plain `down` keeps the volumes.

## Set up and export

`node scripts/init-env.ts` writes `.env` from `.env.example`. It fills only `POSTGRES_PASSWORD`, `N8N_DB_PASSWORD`, `APP_DB_PASSWORD`, `APP_RUNTIME_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, and `DEV_HARNESS_TOKEN` with random hex, and it refuses to overwrite an existing `.env`. The quick start and CI both use it.

`pnpm run setup [-- [--live] [--refresh <id>]]` does five things, in order:

1. It validates the config and stops on a bad one, or on a `SHOPIFY_STORE` that names a different store.
2. It runs `db:migrate`.
3. It imports credentials. It skips one with blank `.env` values, and one that already exists unless `--refresh <id>` names it (repeatable), because re-importing drops an interactive Google sign-in.
4. It publishes the workflows. It skips a workflow not yet in `workflows/`. A workflow marked `liveTrigger` (`shopify-orders`) is published only with `--live`, so running `setup` again without it, after a live publish, takes live order intake offline.
5. It restarts n8n when it published something, then waits out the reconciler.

`pnpm run export` writes n8n's canonical form of every known workflow back to `workflows/` and regenerates the Code nodes. Run it after editing in the n8n UI, and commit the result.

`pnpm run db:migrate` applies each pending `db/migrations/` file in its own transaction, then resets `app_runtime`'s password and attributes from `.env`. A second run prints `no pending migrations`. The guards and logging are in [`database.md`](database.md) under "Migrations".

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real-world examples.
2. Edit the JSON in `workflows/` (IDs from `scripts/lib/manifest.ts`), then run `pnpm run build:workflows`.
3. Validate the JSON with an n8n-aware validator until it reports no errors. Ignore "typeVersion 2.8 exceeds maximum supported version 2.7" on a Postgres node: that validator stops at 2.7, and this repo pins 2.8.
4. Run `pnpm run setup` to import and publish it locally, with `-- --live` once the Shopify credential is ready.
5. Run `pnpm run export` and commit its output, not your hand-edited JSON. The two can differ in server-assigned detail, and the exported form is what runs.
6. Run `pnpm run setup` and `pnpm run export` again, then `git diff --exit-code workflows/`. A non-empty diff means a field leaks instance state; add it to `scripts/lib/normalize-workflow.ts`'s volatile fields.
7. Run the full gate from `AGENTS.md` before committing.

After any restart of the `n8n` container, wait 15 s past `/healthz` before calling a workflow. Until the publication reconciler syncs (every 10 s by default), a call can still run the previous version. `pnpm run setup` waits this out itself.

n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` CLI commands need no owner account, `--userId`, or `--projectId` (checked against `2.45.7`). `publish:workflow` takes effect only after a restart, which `pnpm run setup` performs when it published something.

`.n8n-import/` is a live bind mount that `node scripts/init-env.ts` creates and `pnpm run export` writes to (`.n8n-import/export`). Never `rm -rf` it; the tooling deletes only the files it writes. No credential data crosses it. On Linux, it works only when the host uid matches n8n's container uid (1000).

## Calling the stack by hand

**`node scripts/dev-call.ts <target> '<json>'`** calls the dev harness (`POST {N8N_URL}/webhook/dev`, which needs `DEV_HARNESS_TOKEN`). The targets are `load-config` (`'{}'`) and `intake-order`, which takes a raw order fixture and runs the chain behind the trigger, bypassing the HMAC check:

```sh
node scripts/dev-call.ts intake-order "$(cat tests/fixtures/orders/below-threshold.json)"
```

An unknown target answers 404. The routes and statuses are in [`architecture.md`](architecture.md#http-surface). Calling `intake-order` also starts `process-order`, which reaches Google Sheets, Gmail, and Shopify. Check first that no such credential exists, or a stack wired to real accounts sends real emails and writes a real sheet row.

**`pnpm run send-test-order [-- --fixture <name>] [--order-id <digits>] [--tamper]`** signs a fixture exactly as Shopify signs `orders/create` and posts it to the trigger's real path, which exercises the HMAC check the dev harness bypasses. It reads `N8N_URL`, `SHOPIFY_STORE`, and `SHOPIFY_CLIENT_SECRET` from `.env` and never prints them. The defaults are `below-threshold` and the current timestamp. `--tamper` changes the body after signing. It needs `shopify-orders` published with `--live`.

**`pnpm run shopify:token [-- --client-credentials]`** gets the Admin API token for n8n's Shopify credential and writes `SHOPIFY_ACCESS_TOKEN` into `.env` at mode 0600. The default authorization code grant gives an offline token that doesn't expire. `--client-credentials`, for a same-organization dev store, gives a 24 h token, so re-run it daily, then `pnpm run setup -- --refresh nbcCredShopify01 --live`. See [`shopify-setup.md`](shopify-setup.md) under "Admin API access".

## Checks that need the stack

- **`node scripts/check-db.ts`** proves `app_runtime`'s denials, its exact grant, the role facts, the one workflow statement (rolled back), and the migration ledger. It prints `ok` or `FAIL` per check and exits 1 on any failure. See [`database.md`](database.md) under "Proving it".
- **`node scripts/check-dev-response.ts [--fresh]`** refuses to run if a Google, Gmail, or Shopify credential exists in n8n. Otherwise it calls the harness's `load-config` and `intake-order` targets and asserts each response's shape, exiting 1 on a mismatch. `--fresh` (CI) accepts only the fresh-call shape, so a bug that makes every order a duplicate fails.
- **`pnpm run check:config`** runs `validateConfig` against `config/config.json` and prints `config OK` or the first error.
- **`pnpm run check`** runs the hygiene checks on every workflow (`scripts/check-workflows.ts`). They cover pinned data, `meta.instanceId`, required settings (including `errorWorkflow: nbcErrorHandler1` everywhere except `error-handler` and `load-config`), literal emails, phones, long IDs, and secrets, unknown credential IDs, hand-written or undocumented Code nodes, missing retries, Postgres queries built from expressions or with `$n` inside a SQL comment, and a missing sticky note. `node scripts/check-workflows.ts <dir>` checks any directory.

## Theme commands

- `pnpm run theme:assemble` builds the theme into `.theme-build/theme/` and prints the added and modified files.
- `pnpm run build:theme [-- --check]` bundles `THEME_ENTRIES` (`scripts/build-theme.ts`) into `theme/assets/`, unminified. `--check` exits 1 on drift, and CI runs it.
- `pnpm run theme:check` assembles the theme and runs Shopify's theme check. It exits 1 on any failing offense.
- `pnpm run theme:preview [-- --locale es]` renders the real coffee finder and free-shipping bar with liquidjs and mock data into `.theme-build/preview/index.html`. A missing translation fails instead of falling back to English. Serve it with `python3 -m http.server 8765 --directory .theme-build/preview`. It's an approximation; [`theme/README.md`](../theme/README.md) lists every stub.

## Lighthouse

`pnpm run lighthouse -- --base-theme <id> --theme <id> [--runs 5] [--path /]` compares an unpublished Horizon base theme with the Nubandina theme on Lighthouse's mobile defaults. It runs 5 alternating runs each, then prints each run, the medians, and a row for README's "Theme performance" table.

- **Exit and stop rules.** It exits 1 when Nubandina is more than 2 points below the base on Performance (a chosen tolerance, `PERFORMANCE_MARGIN`), or below it on Accessibility. It stops when a run ends anywhere but the requested theme preview, such as the password page.
- **Needs.** `SHOPIFY_STORE`, `SHOPIFY_STOREFRONT_PASSWORD` (never printed), and a local Chrome (`CHROME_PATH` overrides the lookup).
- **Environment.** Lighthouse runs with only `PATH`, `HOME`, the temp and locale variables, `CHROME_PATH`, and pnpm's own, never `.env`'s secrets.
- **The storefront cookie.** `--extra-headers` sends it to every origin the page loads, replacing the cookies Chrome would send. The cookie file is removed on exit, on error, and on Ctrl+C, and a failed run's report has the cookie removed too. Reports land in `.lighthouse/<date>/`, which is gitignored and safe to delete.
- **Theme IDs** come from `pnpm dlx @shopify/cli@5.0.0 theme list --store <store>.myshopify.com`.
