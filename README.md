# Nubandina Coffee

**Demo**

A Shopify coffee store with a self-hosted n8n order backend. The backend handles each order once. It logs a Google Sheets row, emails the owner, alerts on low stock, and later emails the customer a brewing guide. It's built with a strict TypeScript toolchain and runs locally in Docker.

![System architecture: the storefront sends checkouts to Shopify; the orders/create webhook reaches n8n through an ngrok tunnel; n8n records each order once in Postgres, writes a Google Sheets row, reads stock from Shopify, and emails the owner and the customer through Gmail](docs/diagrams/architecture.svg)

How it works, how it fails, and why it's built this way: [docs/architecture.md](docs/architecture.md). For the full-size, interactive diagram, open [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) from a local clone in a browser.

## Status

The build is complete and verified offline, through tests, workflow and theme checks, and runs against the local n8n instance. Checks that need a live Shopify store, the Google account, the tunnel, or queue mode are listed under "Live checks (pending)" below.

## What works now

Each item below was verified offline.

**Runtime and tooling**

- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` (229 tests) pass. CI runs them, with the workflow, theme, and security checks, on every pull request. A separate `n8n` CI job boots the real n8n 2.45.6 and Postgres, runs `pnpm run setup`, and calls the dev harness's `load-config` and `intake-order` targets, proving the published workflow chain — including two generated Code nodes and a Postgres write — actually executes, with no Shopify, Google, or Gmail credential needed.
- Supply-chain hardening: pnpm with a release-age gate, trust-policy enforcement, blocked exotic sub-dependencies, and build-script approval (`pnpm-workspace.yaml`); every Compose image pinned by digest; a Dependabot cooldown on every ecosystem — see AGENTS.md's "Supply-chain hardening" section.
- Docker Compose runs Postgres 17 and n8n 2.45.6, published on `127.0.0.1` only.
- Databases `app` and `n8n` each belong to their own role, and neither role can open the other's database.
- n8n mounts the config, the brewing guides, and the workflows read-only.
- Queue mode (`compose.queue.yaml`) brings up Redis and two `n8n-worker` containers, all healthy.
- `pnpm run setup` validates the config, imports credentials without printing them, and publishes the workflows. Running `setup` and `export` a second time leaves `workflows/` unchanged.
- Credential import streams the decrypted JSON into the n8n container over stdin, and the existing-credentials check reads the (still encrypted) export back over stdout — neither ever touches the host filesystem or the `.n8n-import/` bind mount. This fixes two Linux-only failures: the runner's uid (1001) writing a file n8n's own uid (1000) couldn't read, and the reverse, n8n's uid writing a file the runner couldn't `chmod` or delete. After a publish, `pnpm run setup` waits for `/healthz`, 15 more seconds for the publication reconciler, then polls the dev harness's own webhook until it stops answering 404 — the fix for a timing race, not a Linux-only failure: the publication reconciler's own schedule means the harness can still 404 for a few seconds right after the restart, on any platform.
- `pnpm run build:workflows -- --check` confirms every Code node matches its TypeScript source, and `pnpm run check` finds no hygiene violations in `workflows/`.

**Order backend**

- The dev harness answers 403 to a call with no `X-Dev-Token` header or a wrong one, and 404 to an unknown target.
- `load-config` returns the mounted config, and a missing file fails the run instead of returning nothing. With the file hidden for 20 seconds, one failed call started `error-handler` once, not in a loop.
- `intake-order` records a fixture order once: the same call again adds no `orders` row and stops at the gate.
- `process-order`'s sheet row, read from a stored execution, matches the unit test. Its owner email renders as expected in n8n's own expression engine.
- `error-handler`'s alert renders for both a failed execution and a trigger that fails to activate.
- The stock check, the low-stock gate, the wait, and the guide email pass structure tests and n8n workflow validation with no errors.
- Unit tests cover every Code node: order normalization and its failure cases, the sheet row, low-stock selection, and the guide email's escaping.

**Shopify tooling**

- `pnpm run shopify:token` builds the authorize URL, verifies a signed callback, and writes `.env` at mode 0600, tested against a stubbed `fetch`.
- `pnpm run send-test-order` signs a fixture order the way Shopify signs a webhook, or tampers with it after signing, tested offline.
- `data/products.csv` uses the headers of Shopify's public sample CSV, and `docs/shopify-setup.md` walks through the store setup.

**Storefront**

- `pnpm run theme:check` passes on the assembled theme, with no failing offenses in this repo's 4 added and 3 modified files. Horizon's own baseline is 6 warnings.
- The free-shipping bar's math passes unit tests, including a total exactly at the threshold and a blank or zero threshold.
- The coffee finder's recommendations pass unit tests for a full match, a partial match, the party-size switch, sold-out products, and malformed input.

## Quick start

```sh
node scripts/init-env.ts   # writes .env with fresh local secrets; leaves ngrok/Shopify/Google blank
cp config/config.example.json config/config.json

docker compose up -d --wait
curl -s localhost:5678/healthz
pnpm run setup
```

n8n is then at <http://localhost:5678>. Fill in the blank third-party values (ngrok, Shopify, Google OAuth) in `.env` by hand before relying on anything that needs them; `init-env.ts` already generated the local secrets (Postgres roles, `N8N_ENCRYPTION_KEY`, `DEV_HARNESS_TOKEN`) — see `.env.example` for what's required.

## Limitations

Deliberate simplifications, each with its ceiling and upgrade path:

- **`intake-order` processes only the first order of a call.** `Process order`'s input reads `.first()` off `Normalize order`'s output, which is exact as long as a webhook call carries exactly one order, as it does today. A future caller that hands `intake-order` more than one item at once would still only process the first of them. Upgrade path: read the order from the current item (`.item`) instead of always taking the first one.
- **Shopify gets its HTTP 200 before the order is recorded.** The Shopify Trigger answers on receipt, before `Hand to intake` or anything inside `intake-order` runs. A failure past that point — a database outage, a bad hand-edited config — never shows up to Shopify as anything but success; it's visible only in n8n's own executions list, not in a delivery status.
- **A lost `Record order` response can strand an order with no alert.** If the INSERT actually commits but its response never reaches n8n before a retry runs, the retry's `ON CONFLICT DO NOTHING` suppresses it, reporting the same `{success: true}` a genuine duplicate would — so the order looks already handled even though nothing downstream of the gate ever ran. See `AGENTS.md`'s recovery steps.
- **"Read stock and brew methods" has no per-request timeout.** The GraphQL node (unlike HTTP Request) exposes no `options.timeout`, so a hung Shopify response blocks this execution until n8n's own default times it out, rather than failing fast on a bounded ceiling. Upgrade path: switch to the HTTP Request node with `options.timeout` plus an explicit `errors` check, trading the GraphQL node's built-in throw-on-`errors` behavior for a manual one.
- **A wait shorter than 65 seconds doesn't survive a restart.** n8n 2.45.6 only persists a Wait node's sleep past `MAX_IN_PROCESS_WAIT_MS`; anything shorter stays in the process's own memory and is lost if n8n restarts mid-wait. `guide_delay_minutes` is validated at 2 or more precisely because of this ceiling. Upgrade path: none needed at this delay — it's n8n's own design, not something this repo works around.
- **Queue mode's Redis has no password.** `compose.queue.yaml` publishes no Redis port, so only containers on the Compose network can reach it, but any of them can. Upgrade path: set `QUEUE_BULL_REDIS_PASSWORD` before running queue mode in production.
- **`pnpm run setup` waits 15 seconds after restarting n8n, then polls the dev harness's webhook until it's registered.** `/healthz` reports healthy before the publication reconciler syncs the published versions, every 10 seconds by default. The webhook poll proves the harness is live, not that every sub-workflow already runs its newest published version under a slower reconciler. Upgrade path: poll `workflow_published_version` against `workflow_entity.activeVersionId` instead of the fixed wait.
- **The free-shipping bar can disagree with checkout.** It reads `cart.total_price`, which is the total after cart-level discounts but before anything applied at checkout. A discount code entered at checkout can still take the order below the free-shipping rate after the bar has already shown "You've got free shipping!".

## Live checks (pending)

These need a live, `--live`-published `shopify-orders` trigger with a real Shopify credential, so they aren't run yet:

- A valid order (`pnpm run send-test-order -- --fixture below-threshold --order-id <digits>`) produces one "Shopify orders" execution, one "Intake order" execution, and one `orders` row.
- The same order sent again produces another "Shopify orders" execution, but that run's "Intake order" stops at "Is new order?"; the `orders` row count doesn't change.
- A signed test order (`--fixture free-shipping`) adds exactly one `Orders` row and sends one owner email. The row matches the first test in `tests/nodes/order-row.test.ts`, except `order_number` (`#T<digits>`).
- Deleting that order's `orders` row (`docker compose exec -T postgres psql -U "$APP_DB_USER" -d app -c "DELETE FROM orders WHERE order_id = '<digits>'"`) and sending it again with the same `--order-id` updates its `Orders` row; it doesn't add a second one. n8n refuses to retry a successful execution, so this re-sends the order instead.
- An order whose shipping name is `=1+1` shows the literal text `=1+1` in the `customer` cell.
- A tampered signature (`pnpm run send-test-order -- --tamper --order-id <digits>`) gets HTTP 200, starts no execution at all, and creates no row.
- In one real order's execution data, every field `normalize-order` reads is present (`admin_graphql_api_id`, `name`, `email`, `shipping_address.name`/`city`, `line_items[].variant_id`/`variant_title`/`sku`, `total_shipping_price_set`, `shipping_lines`). If a field moved, update the fixture and the mapper.
- **Low stock.** A real order of 2 × Sierra Nevada 500 g (stock 6) sends `Low stock after order <#>` with the line `Sierra Nevada (500 g), SKU NBC-SNV-500: 4 left (threshold 5)`. An order of Huila 250 g sends no alert.
- **Unknown variants.** A signed fixture order, whose variants don't exist in the store, sends no alert and doesn't fail.
- **Stock-read failure.** Setting `config.shopify.store` to a store subdomain that doesn't exist makes the stock read fail after its retries. The error workflow then emails the owner. After restoring the subdomain, the next order reads stock again. Retrying the failed run from the UI fails again, because a retry reuses the config the run started with.
- **Two methods.** With `guide_delay_minutes: 2`, a real order of Nariño 250 g plus Sierra Nevada 250 g gets one email, about 2 minutes later, with Pour-over and Espresso sections.
- **Restart during the wait.** Restarting n8n (`docker compose restart n8n`) during a wait still delivers the guide.
- **No email address.** An order without one sends no guide and doesn't fail.
- **Real delay.** With `guide_delay_minutes` back at 60, one order's guide arrives about an hour later. n8n shows the execution as waiting until then.
- **Live file edits.** Editing a step in `data/brewing-guides.json` changes the next guide, with no re-import.
- **Subscription cycle.** After `pnpm run setup -- --live`, `GET /admin/api/2026-10/webhooks.json` shows a new subscription ID.

These need the ngrok tunnel, or queue mode with the live trigger, so they aren't run yet:

- **Tunnel.** Through the public ngrok URL, `/`, `/rest/login`, `/webhook-test/x`, `/webhook/dev/x`, and `//webhook/x` each return 404, and only the trigger's own path reaches n8n.
- **Queue mode.** With `compose.queue.yaml` and two workers, a signed order runs on a worker and adds its `Orders` row.

These need `npx @shopify/cli@5.0.0 theme dev` against `.theme-build/theme`, so they aren't run yet:

- **Drawer.** With Sierra Nevada 250 g in the cart, it shows "You're $82.000 away from free shipping" at 31%.
- **Live updates.** Raising the quantity to 4 (152,000 COP) switches it to "You've got free shipping!" without a reload, in the drawer and on `/cart`. Lowering it again restores the remaining message.
- **Boundary.** Huila 250 g plus Huila 500 g (exactly 120,000 COP) shows the reached message, and checkout charges 0 shipping.
- **Disabled.** A blank threshold, or unticking "Show the free shipping bar", hides the bar with no console errors.
- **Keyboard path.** Tab reaches each radio group and arrow keys move within it. Submitting "Pour-over / Mild and bright / Just me" moves focus to "Our pick for you", which shows one card: Nariño 250 g, its price, and its notes.
- **Adding to cart.** "Add to cart" with Enter opens the cart drawer, and the free-shipping bar reflects the new total.
- **Second option.** "Espresso / Mild and bright / Three or more" shows two cards, Sierra Nevada 500 g and then Nariño 500 g.
- **Theme editor.** The section can be added to another page, its texts edited, and the section removed, all without code.
- **No errors.** The console shows no errors, and `Shopify.actions` is present. Note it if it's absent: the Cart AJAX fallback then handles "Add to cart".
