import { expect, it } from 'vitest';
import { planCredentialImport } from '../../scripts/setup-credentials.ts';
import { CREDENTIALS } from '../../scripts/lib/manifest.ts';

const env = Object.fromEntries(CREDENTIALS.flatMap((c) => c.env).map((k) => [k, `${k.toLowerCase()}-test`]));
const plan = (o: Partial<Parameters<typeof planCredentialImport>[0]>) =>
  planCredentialImport({ env, existingIds: new Set(), refresh: new Set(), ...o });

it('builds every credential with its fixed id', () =>
  expect(plan({}).credentials.map((c) => c.id).sort()).toEqual(CREDENTIALS.map((c) => c.id).sort()));
it('shapes the Shopify and Postgres data for n8n 2.45.6', () => {
  const byId = new Map(plan({}).credentials.map((c) => [c.id, c.data]));
  expect(byId.get('nbcCredShopify01')).toEqual({ shopSubdomain: 'shopify_store-test', accessToken: 'shopify_access_token-test', appSecretKey: 'shopify_client_secret-test' });
  expect(byId.get('nbcCredAppDb0001')).toEqual({ host: 'postgres', port: 5432, database: 'app', user: 'app_db_user-test', password: 'app_db_password-test', ssl: 'disable' });
});
it('skips credentials with missing env and names the variables', () =>
  expect(plan({ env: { APP_DB_USER: 'u', APP_DB_PASSWORD: 'p' } }).skipped).toContainEqual({ id: 'nbcCredShopify01', reason: 'missing SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN, SHOPIFY_CLIENT_SECRET' }));
it('never overwrites an existing credential unless asked', () => {
  expect(plan({ existingIds: new Set(['nbcCredGSheets01']) }).skipped).toContainEqual({ id: 'nbcCredGSheets01', reason: 'exists' });
  expect(plan({ existingIds: new Set(['nbcCredShopify01']), refresh: new Set(['nbcCredShopify01']) }).credentials.map((c) => c.id)).toContain('nbcCredShopify01');
});
