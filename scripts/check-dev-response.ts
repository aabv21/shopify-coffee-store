import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/compose.ts';
import { callDev } from './lib/dev-client.ts';
import { CREDENTIALS } from './lib/manifest.ts';
import { existingCredentialIds } from './setup-credentials.ts';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/orders/below-threshold.json', 'utf8')) as Record<string, unknown>;

const EXPECTED_CONFIG = {
  owner_email: 'owner@example.com',
  google: { orders_sheet_id: 'REPLACE_ME', orders_tab: 'Orders' },
  shopify: { store: 'replace-me', api_version: '2026-10' },
  low_stock_threshold: 5,
  guide_delay_minutes: 60,
};

/**
 * True for a credential type this harness call must never run near: Shopify, Google (Sheets,
 * Drive, ...), or Gmail. `process-order` — which `intake-order` hands off to, fire-and-forget —
 * reaches all three. Matched by type name, not a hand-picked list, so a future credential of one
 * of these kinds is covered automatically.
 */
function isGuardedType(type: string): boolean {
  return /shopify|google|gmail/i.test(type);
}

/** Every manifest credential id whose type is Google, Gmail, or Shopify — derived, never hand-picked. */
export function guardedCredentialIds(): string[] {
  return CREDENTIALS.filter((c) => isGuardedType(c.type)).map((c) => c.id);
}

/**
 * `intake-order` hands off to `process-order` fire-and-forget (`waitForSubWorkflow: false`):
 * calling `intake-order` always starts that second execution, win or lose. In CI there is no
 * Shopify, Google, or Gmail credential, so `process-order`'s own run fails harmlessly and the
 * harness response (asserted below) is unaffected — but on a developer's stack wired to the
 * owner's real accounts, that second execution would append a real sheet row and send real
 * emails. Refuses to call `intake-order` at all when any such credential already exists, naming
 * which one. Never decrypts anything: reuses `setup-credentials.ts`'s own `existingCredentialIds`,
 * the same CLI-export, ids-only detection `setupCredentials` runs before every import.
 */
export function assertNoLiveCredential(existingIds: ReadonlySet<string>): void {
  const names = new Map(CREDENTIALS.map((c) => [c.id, c.name]));
  const present = guardedCredentialIds().filter((id) => existingIds.has(id));
  if (present.length === 0) return;
  const label = present.map((id) => `${names.get(id) ?? id} (${id})`).join(', ');
  throw new Error(
    `refusing to call intake-order: a real Google/Gmail/Shopify credential already exists in n8n (${label}). ` +
      'process-order would run against it fire-and-forget. Rely on unit tests and CI instead.',
  );
}

/**
 * True for the shape a fresh call produces: `intake-order` records the order, loads and checks
 * config, and hands off to `process-order` fire-and-forget — the dev harness relays that last
 * Execute Workflow node's own *input* mapping (`{ order, config }`) since it isn't waiting on the
 * sub-execution. Reaches `Normalize order` and `Check config`, the two CODE_NODES entries on this
 * path. `order_id`/`order_number` come straight from the fixture, pinned regardless of run date.
 */
export function isFreshIntakeResponse(result: unknown): result is { order: Record<string, unknown>; config: unknown } {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result).sort();
  if (keys.length !== 2 || keys[0] !== 'config' || keys[1] !== 'order') return false;
  const r = result as Record<string, unknown>;
  if (typeof r.order !== 'object' || r.order === null) return false;
  const order = r.order as Record<string, unknown>;
  return (
    order.order_id === '7000000001' &&
    order.order_number === '#T1001' &&
    JSON.stringify(r.config) === JSON.stringify(EXPECTED_CONFIG)
  );
}

/**
 * True for the shape a duplicate call produces: `Record order`'s own `ON CONFLICT DO NOTHING`
 * response, with no `order_id`, once `Is new order?` stops the chain (see intake-order.json's own
 * sticky note on this). A re-run against a stack that already recorded this fixture's order id
 * hits this branch instead of the fresh one above.
 */
export function isDuplicateIntakeResponse(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return keys.length === 1 && keys[0] === 'success' && (result as Record<string, unknown>).success === true;
}

/** True for `load-config`'s own response: the mounted config, unvalidated, read straight from the file — no generated Code node on this path (see AGENTS.md), kept only as a second, cheap liveness check. */
export function isLoadConfigResponse(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return keys.length === 1 && keys[0] === 'config' && JSON.stringify((result as Record<string, unknown>).config) === JSON.stringify(EXPECTED_CONFIG);
}

/**
 * The checks this script runs. `intake-order`'s predicate depends on `fresh`: with it (CI, which
 * always starts from an empty database), only `isFreshIntakeResponse` counts, so a bug that made
 * `Record order` never return its row — and so every order read as a duplicate — fails loudly
 * instead of passing on CI's own fresh database. Without it (a local re-run against a stack that
 * already recorded this fixture's order), either shape is accepted, since a duplicate response is
 * the correct, expected outcome there.
 */
export function checksFor({ fresh }: { fresh: boolean }): readonly { target: string; input: unknown; isExpected: (result: unknown) => boolean }[] {
  return [
    { target: 'load-config', input: {}, isExpected: isLoadConfigResponse },
    {
      target: 'intake-order',
      input: FIXTURE,
      isExpected: fresh ? isFreshIntakeResponse : (r: unknown) => isFreshIntakeResponse(r) || isDuplicateIntakeResponse(r),
    },
  ];
}

async function main(): Promise<void> {
  loadDotEnv();
  const fresh = process.argv.includes('--fresh');
  const existingIds = await existingCredentialIds();
  assertNoLiveCredential(existingIds);

  for (const { target, input, isExpected } of checksFor({ fresh })) {
    const result = await callDev(target, input);
    console.log(JSON.stringify({ target, result }, null, 2));
    if (!isExpected(result)) {
      throw new Error(`${target}: unexpected response ${JSON.stringify(result)}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
