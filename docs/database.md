# How the database is run

One Postgres 17 server holds two databases: `n8n`, n8n's own (workflows, credentials, executions), and `app`, the order backend's (`orders`, and the migration ledger `schema_migrations`). This page covers which role reaches what, every statement the workflow issues and the grant behind it, how schema changes ship, retention, backup and restore, connections, the upgrade path for an existing local volume, and how `node scripts/check-db.ts` proves the protections hold. The [architecture doc](architecture.md) covers the data model's place in the order flow.

## Roles

| Role | Owns | Used by | Can |
|---|---|---|---|
| `postgres` (`POSTGRES_USER`) | the server | `db/init/` and `db-migrate`, over the `postgres` container's local socket | Everything. It's never configured in the n8n container. |
| `n8n` (`N8N_DB_USER`) | database `n8n` | n8n itself | Its own database only. |
| `app` (`APP_DB_USER`) | database `app` and its tables | `db/init/` and `db-migrate` only | Everything in `app`. Never configured in n8n. |
| `app_runtime` (`APP_RUNTIME_DB_USER`) | nothing | the `App DB` credential, which the one Postgres node in `workflows/` uses | The DML listed below, and nothing else. |

`db/migrations/001_runtime_role.sql` creates `app_runtime` and grants it exactly what the statement below needs. This repo has no node that issues its own DDL — there's no Postgres Chat Memory node in these workflows — so, unlike demo 1, every Postgres node connects as the same runtime role; there's no second, owner-backed credential to maintain.

## Every statement and what covers it

The only Postgres node in `workflows/` runs as `app_runtime`. Its `WHERE` (the conflict check) and `RETURNING` both read the row, so the insert needs `SELECT` as well as `INSERT`; this was checked against Postgres 17 with a role that held only `INSERT`, which fails `ON CONFLICT (order_id) DO NOTHING RETURNING order_id` with `permission denied for table orders`. The "Served by" column comes from `EXPLAIN` on Postgres 17.

| Workflow › node | Statement | Privileges it needs | Served by |
|---|---|---|---|
| `intake-order` › Record order | `INSERT INTO orders (order_id, order_number) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING RETURNING order_id` | `INSERT`; `SELECT` for the conflict check and `RETURNING` | primary key, as the conflict arbiter |

So `app_runtime` holds `SELECT, INSERT` on `orders`, and nothing else: no `UPDATE`, no `DELETE`, no sequence (the table's key is the Shopify order id, not a generated one), and nothing on `schema_migrations`.

## The checklist

### 1. Roles

- **The schema owner isn't the runtime role.** `app` owns `orders` and `schema_migrations`, the latter created under `SET LOCAL ROLE` by `db-migrate`. n8n's app credential, `App DB`, connects as `app_runtime`.
- **What `app_runtime` can't do.**
  - **DML only.** It has `SELECT, INSERT` on `orders` and nothing else: no DDL in `app`, no `TRUNCATE`. `001_runtime_role.sql` runs `REVOKE CREATE ON SCHEMA public FROM PUBLIC` and grants it nothing beyond `USAGE`.
  - **No wider grants.** No `TRUNCATE`, no `UPDATE`, no `DELETE`, and no column-level grant beyond its table grant.
  - **No membership.** It's a member of no role, so it can't `SET ROLE` to the owner.
  - **No attributes.** `db-migrate` re-asserts `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` every time it sets the password.
  - **No `n8n`.** `db/init/` revokes `PUBLIC`'s access, and the migration runs `REVOKE ALL ON DATABASE n8n FROM app_runtime`.
  - **`CONNECT` on `app`, without `TEMP`.** `db/init/` revoked `PUBLIC`'s defaults there.
- **Its own name.** `db-migrate` refuses to run when `APP_RUNTIME_DB_USER` equals `POSTGRES_USER`, `N8N_DB_USER`, or `APP_DB_USER`, which would aim the runtime grants and password at another role.
- **No default privileges.** A new table would get its grants in its own migration; there is none today beyond the baseline.
- **The superuser stays out of n8n.** It runs only `db/init/` and `db-migrate`, and neither n8n container is configured with it.
- **The `postgres` maintenance database** keeps its default `PUBLIC` `CONNECT` and `TEMP`, so `app_runtime` can connect there and create temporary tables. This repo leaves that database alone: it holds no data, and nothing in it reaches `app` or `n8n`.

### 2. Schema

- **Primary keys:** every table has one: `orders (order_id)` and `schema_migrations (filename)`.
- **CHECKs on enumerated columns:** none — `orders` has no enumerated text column.
- **`NOT NULL`:** set on every required value: `order_id`, `order_number`, `received_at`, and `applied_at`. No column is nullable.
- **Timestamps** are `timestamptz` (`received_at`, `applied_at`). This repo has no MySQL.

### 3. Indexes

The only production query against `orders` is the insert itself (`Record order`), served by the primary key, as the table above shows — there is no separate lookup query to index. Nothing else in `workflows/` queries `orders`.

### 4. Queries

- **Bound values only.** The one Postgres node passes its values as `$n` Query Parameters. `pnpm run check` rejects a query that contains a `{{ }}` expression, and a `$n` placeholder inside a SQL comment.
- **CI runs the statement.** `check-db` runs the workflow's own statement exactly as written, with psql's `\bind` supplying the values.

### 5. Migrations

`db/schema.sql` is the baseline, which `db/init/` loads on an empty volume. Every change after it is a file in `db/migrations/`, named `NNN_short_name.sql`. `pnpm run db:migrate` (`scripts/db-migrate.ts`) applies them, and `pnpm run setup` runs it first. On each run, it:

1. **Checks the files and `.env` first.** It stops before touching the database in three cases. Each error names files and variables, never a value.
   - A file contains a transaction-control statement (`BEGIN`, `COMMIT`, `ROLLBACK`, `ABORT`, `START TRANSACTION`, or `END`), which would split the file from its ledger row.
   - `APP_RUNTIME_DB_USER` names the same role as another role variable.
   - A variable that a pending file reads with `\getenv` is unset or empty.
2. **Opens the ledger.** As the owner role, it creates `schema_migrations` if it's missing, then reads the files already recorded there.
3. **Applies each pending file in order,** as the superuser over the container's local socket, with `--single-transaction` and `ON_ERROR_STOP`. Each file's transaction first takes a fixed advisory lock (`pg_advisory_xact_lock`), so two runs can't interleave. A concurrent second run then fails on the ledger's primary key instead of recording a file twice. The `INSERT` into `schema_migrations` is the file's last statement, so a failed file leaves no change and no record.
4. **Sets `app_runtime`'s password and attributes** from `APP_RUNTIME_DB_PASSWORD`, even when no migration ran, with `ALTER ROLE … WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD …`. A hand-granted attribute doesn't survive the next run. `setup-credentials` rebuilds the `App DB` credential from `.env` on every run, so the role's password must follow it the same way. To rotate it, change `.env` and run `pnpm run setup`.

There is no schema change beyond the role in this repo: `001_runtime_role.sql` is the only migration, and `db/schema.sql`'s baseline `orders` table needs no column, index, or constraint change to serve the one statement above.

`db-migrate` passes each variable to `docker compose exec` as a bare `-e NAME`. Docker copies the value from `db-migrate`'s own environment, so it never appears in an argument list or in `ps`, and psql reads it with `\getenv`. A password reaches the server only inside `ALTER ROLE … PASSWORD`, which psql quotes itself. `db-migrate` redacts every `.env` secret from psql's output before printing an error.

Postgres also logs a failed statement's full text by default (`log_min_error_statement = error`), and `ALTER ROLE … PASSWORD` carries the password. So the password step first runs `SET LOCAL log_min_error_statement = panic` and `SET LOCAL log_statement = 'none'` inside its own transaction. `db/init/` does the same for its session before it creates the n8n and app roles. A failed `ALTER ROLE` then logs its error, never its statement. `db/init/` also stops at once if `N8N_DB_PASSWORD` or `APP_DB_PASSWORD` is empty.

A file must be safe to run twice:

- `001` creates the role through `\gexec` only `WHERE NOT EXISTS`.
- `GRANT` and `REVOKE` are idempotent.

The ledger already skips applied files, so a second `pnpm run setup` prints `no pending migrations`. `001` reads `APP_RUNTIME_DB_USER` once, so renaming the role later takes a new migration.

### 6. Retention

**App tables:** `orders` holds only the Shopify order id and the merchant-facing order number — no name, email, address, phone, or any other customer data. There is no retention job for it, and none is needed: these two identifiers aren't personal data on their own, and `orders` is the idempotency gate's own record of which orders have already been seen, which the gate must keep indefinitely to keep working. `schema_migrations` holds no personal data either; it's the ledger.

**n8n execution data:** `compose.yaml` keeps `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168`, so n8n deletes executions after 168 hours. A manual execution, started from the editor, is saved by default with every node's input and output. Every workflow in `workflows/` sets `settings.saveManualExecutions: false`, with no per-workflow exception, and `tests/workflows.test.ts` asserts it for every file. A per-workflow list wouldn't hold: `intake-order`, `process-order`, `shopify-orders`, and `dev-harness` each carry an order's customer name, email, address, or the dev harness's own `X-Dev-Token` header, but `load-config` and `error-handler` aren't exempt either — both start from a passthrough Execute Workflow Trigger whose caller sends no input schema, so each receives its caller's whole item: `load-config`'s caller passes it the order and config it's about to use, and `error-handler`'s caller passes it the failed execution's own data.

Production executions are still saved, then pruned at 168 hours.

### 7. Backup and restore

Back up `app` from the running stack. Every command runs in the `postgres` container, so no port or password crosses the host. A dump holds Shopify order identifiers, so write it outside the repo, with a `0600` mode:

```bash
mkdir -p ~/nubandina-backups
(umask 077; docker compose exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d app' > ~/nubandina-backups/app.dump)
```

To check a dump, restore it into a scratch database, compare the row counts, then drop only that database:

```bash
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" -O "$APP_DB_USER" app_restore_check'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d app_restore_check --exit-on-error' < ~/nubandina-backups/app.dump
for db in app app_restore_check; do
  docker compose exec -T postgres sh -c "psql -X -At -U \"\$POSTGRES_USER\" -d $db -c \"SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations\""
done
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" app_restore_check'
```

This was run once against the local stack: both `app` and `app_restore_check` counted the same `orders` and `schema_migrations` row counts after the restore, and the scratch database was dropped afterward.

To restore over `app` itself, stop n8n first, so nothing writes during the restore. `--clean --if-exists` drops each object in the dump before recreating it:

```bash
docker compose stop n8n
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d app --clean --if-exists --exit-on-error' < ~/nubandina-backups/app.dump
docker compose start n8n
```

Roles live at the server level, so a dump doesn't carry them; on a fresh volume, `db/init/` and `pnpm run db:migrate` recreate them from `.env`.

**n8n's own database** backs up the same way, with `-d n8n`. Its credentials are encrypted with `N8N_ENCRYPTION_KEY`, so keep that key, from `.env`, alongside the dump. A dump without the key restores workflows, but none of their credentials.

### 8. Connections

- **No published port.** `compose.yaml` publishes no Postgres port. Only containers on the Compose network reach it, and the dumps above go through `docker compose exec`.
- **Where credentials live.** Only in `.env`, which git ignores, and in n8n's credential store, which `N8N_ENCRYPTION_KEY` encrypts.
- **Authentication by path.** n8n connects over the Compose network, where `pg_hba.conf` requires `scram-sha-256`. Inside the `postgres` container, the local socket and loopback use the official image's `trust` default, which `db/init/`, `db-migrate`, and `check-db` rely on. Reaching that socket takes `docker exec`, and Docker access on the host is already root-equivalent.
- **No TLS on the network.** The credential sets `ssl: disable`, and the server runs with `ssl = off`. That's a limit of this local, single-host demo.
- **What production would need:**
  - TLS with a CA-signed server certificate, and the client verifying it (`sslmode=verify-full`);
  - Postgres on a private network or a managed service;
  - `pg_hba.conf` narrowed to n8n's own address;
  - no `trust` lines;
  - rotated passwords.

## Upgrading an existing local stack

These steps take a volume created before `db/migrations/` existed to the current state, without losing data. Never run `docker compose down -v`: the volume also holds n8n's own database, with its credentials and sign-ins.

1. **Pull the change.**
2. **Add the two new `.env` names.** `.env.example` shows them. Write the password straight into the file, so it never reaches the terminal:

   ```bash
   { echo; echo 'APP_RUNTIME_DB_USER=app_runtime'; printf 'APP_RUNTIME_DB_PASSWORD='; openssl rand -hex 24; } >> .env
   ```

   The leading `echo` keeps a `.env` without a final newline from running its last line into the first new one.

   Don't regenerate `.env` with `node scripts/init-env.ts` on an existing volume. It would replace `N8N_ENCRYPTION_KEY` and every role password, which locks n8n out of its credentials and its own database. If you skip this step, `pnpm run db:migrate` stops before it touches anything and names the missing variables.
3. **Start the stack with `docker compose up -d --wait`.** This recreates `postgres` with the two new variables in its environment. `db-migrate` doesn't depend on that, since it forwards the current `.env` values itself, but the service definition changed.
4. **Run `pnpm run setup`.** It applies `001_runtime_role.sql`, sets `app_runtime`'s password, and rebuilds the `App DB` credential from `.env`. Since that credential already exists in n8n, this step alone would be skipped — see the next step.
5. **Refresh the `App DB` credential once.** `setup-credentials` skips a credential that already exists unless it's named with `--refresh <id>`, because re-importing one unconditionally would otherwise drop an interactive Google sign-in on a different credential. The `App DB` credential has no such sign-in, but the same skip rule still applies to it, so on an existing stack it keeps pointing at the old `APP_DB_USER` value until it's refreshed by id:

   ```bash
   pnpm run setup -- --refresh nbcCredAppDb0001
   ```

   After this, `App DB` connects as `app_runtime`, not `app`.

   **If this step is skipped, nothing else notices.** The credential keeps connecting as the owner role `app`, which can create and drop tables, truncate `orders`, and read or write anything in the database — every grant this change is meant to take away. `check-db` and `check-dev-response` still pass, because neither inspects which role the credential actually uses: `check-db` runs its own `psql` sessions directly as `app_runtime` (from `.env`, not from n8n's credential), and `check-dev-response` only asserts the shape of `intake-order`'s response, which looks identical whether `Record order` ran as `app` or `app_runtime`. n8n's credential export (`existingCredentialIds`, which `setup-credentials` also uses to decide whether to skip) only ever returns encrypted data — ids, names, and types — so no check can read a credential's `user` field without decrypting it, which this tooling deliberately never does. The only way to tell is to run the refresh above, or to open the credential in n8n's editor and read its `User` field (never print it from a script).
6. **Run `node scripts/check-db.ts`.** A second `pnpm run setup` prints `no pending migrations` and reports `exists` for `App DB` again, since by then it's already been refreshed.

## Proving it: `check-db`

`node scripts/check-db.ts` runs psql inside the `postgres` container, mostly as `app_runtime`, and prints `ok` or `FAIL` for each check. It exits 1 if any check fails. Each check has a unit-tested predicate in `tests/scripts/check-db.test.ts`.

| Check | Passes when |
|---|---|
| CREATE TABLE is denied | Postgres answers `permission denied for schema public` |
| DROP TABLE orders is denied | `must be owner of table orders` |
| TRUNCATE orders is denied | `permission denied for table orders` |
| connecting to the n8n database is denied | `permission denied for database "n8n"` |
| SET ROLE to the owner is denied | `permission denied to set role` |
| no role attribute, membership, column grant, or TEMP/CREATE on app beyond the grant list | Checked as the superuser: `app_runtime` holds none of `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`; `pg_auth_members` lists it as a member of nothing; `has_any_column_privilege` finds no column privilege its table grant doesn't cover; and it has no `TEMP` or `CREATE` on `app` |
| table privileges are exactly the grant list | `app_runtime`'s privileges on every table and sequence in `public` equal `RUNTIME_GRANTS` (`orders: SELECT, INSERT`): none missing, none extra |
| every workflow Postgres statement runs | the one statement runs as `app_runtime`, inside one transaction it rolls back |
| `schema_migrations` lists every file in `db/migrations` | every file is recorded |

- **What counts as a denial.** Only the expected one passes. A statement that succeeds fails the check, and so does psql failing for any other reason, such as a missing role or a stopped container.
- **Nothing persists.** The one statement that could change data runs inside `BEGIN … ROLLBACK`.
- **The statement check reads the workflow.** It runs the Postgres node's query straight from `intake-order.json`. A unit test fails when a new Postgres node has no probe values in `PROBES`, and a separate test confirms no other workflow in `workflows/` touches Postgres at all.

CI's `n8n` job runs `check-db` after `pnpm run setup` on a fresh volume. Then `check-dev-response.ts --fresh` drives `intake-order` through n8n, which proves `app_runtime`'s grants hold for a real run. On a fresh volume this is airtight, since `App DB` is imported fresh and can only be built from `APP_RUNTIME_DB_USER`. **It is not airtight on an upgraded local stack that skipped the refresh step above**: both checks would still report success, because neither one asks n8n which role its own credential actually uses — `check-db` runs its own, independent `psql` session as `app_runtime`, and `check-dev-response` only checks the shape of `intake-order`'s response. A stale `App DB` credential still connecting as the owner role `app` would pass both checks while every actual order write ran with full owner privileges. Short of decrypting the credential store, the refresh step is the only way to close this gap on an existing stack.

To prove the check can fail, grant a forbidden privilege by hand as the superuser, then run it. Each of these makes `check-db` exit 1:

- `GRANT CREATEDB` on the role (`ALTER ROLE app_runtime CREATEDB`) fails the role-attribute check. The table-privilege check misses it.
- `GRANT app TO app_runtime` fails the role-attribute check and "SET ROLE to the owner is denied".
- `GRANT UPDATE (order_number) ON orders TO app_runtime` fails the role-attribute check (the column-grant clause). The table-privilege check misses it, since `has_table_privilege` only sees whole-table privileges.
- `GRANT CREATE ON DATABASE app TO app_runtime` fails the role-attribute check with `has CREATE on app`. The table-privilege check misses it too — a leaked `app_runtime` credential could otherwise `CREATE SCHEMA`/`CREATE TABLE` in `app` with every other check still green.
- `GRANT UPDATE ON orders TO app_runtime` fails "table privileges are exactly the grant list" directly, since it's a whole-table grant beyond `RUNTIME_GRANTS`.

Revoke each one afterward. `pnpm run db:migrate` also resets the role's attributes on its own.
