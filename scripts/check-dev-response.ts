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
  default_locale: 'en',
  team_locale: 'en',
};

/** Shopify, Google, or Gmail: what `process-order` reaches. Matched by type, so a new credential of these kinds is covered. */
function isGuardedType(type: string): boolean {
  return /shopify|google|gmail/i.test(type);
}

export function guardedCredentialIds(): string[] {
  return CREDENTIALS.filter((c) => isGuardedType(c.type)).map((c) => c.id);
}

/**
 * Calling `intake-order` always starts `process-order` fire-and-forget. With no live credential (as
 * in CI) that run fails harmlessly; on a stack wired to real accounts it would append a real sheet
 * row and send real emails, so this refuses. The ids come from an encrypted, ids-only export.
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
 * A fresh call: the harness relays the fire-and-forget `Process order` node's input mapping
 * (`{ order, config }`), after `Normalize order` and `Check config` ran. `locale` is the fixture's
 * `es-CO`, normalized.
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
    order.locale === 'es' &&
    JSON.stringify(r.config) === JSON.stringify(EXPECTED_CONFIG)
  );
}

/** A duplicate call: `Record order`'s bare `ON CONFLICT DO NOTHING` result, stopped at `Is new order?`. */
export function isDuplicateIntakeResponse(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return keys.length === 1 && keys[0] === 'success' && (result as Record<string, unknown>).success === true;
}

/** `load-config`'s unvalidated config; a cheap second liveness check, with no Code node on its path. */
export function isLoadConfigResponse(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return keys.length === 1 && keys[0] === 'config' && JSON.stringify((result as Record<string, unknown>).config) === JSON.stringify(EXPECTED_CONFIG);
}

/**
 * With `fresh` (CI's empty database), only the fresh shape passes, so a bug that made every order
 * read as a duplicate fails. Without it, a local re-run may also get the duplicate shape.
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
