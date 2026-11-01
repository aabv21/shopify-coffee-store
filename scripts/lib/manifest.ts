export interface WorkflowEntry {
  id: string;
  name: string;
  file: string;
  publish: boolean;
  liveTrigger: boolean;
}

export interface CredentialEntry {
  id: string;
  name: string;
  type: string;
  env: readonly string[];
  data: (env: Readonly<Record<string, string>>) => Record<string, unknown>;
}

export interface CodeNodeEntry {
  file: string;
  node: string;
  source: string;
  why: string;
}

export const ERROR_WORKFLOW_ID = 'nbcErrorHandler1';

export const TRIGGER_WEBHOOK_ID = '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

/** `env[key]` widened past `noUncheckedIndexedAccess`; callers only reach here once the key is known to be set. */
// eslint-disable-next-line security/detect-object-injection -- key is always one of this entry's own fixed `env` names
const readEnv = (env: Readonly<Record<string, string>>, key: string): string => env[key] ?? '';

export const WORKFLOWS: readonly WorkflowEntry[] = [
  { id: 'nbcLoadConfig001', name: 'Load config', file: 'load-config.json', publish: true, liveTrigger: false },
  { id: ERROR_WORKFLOW_ID, name: 'Error handler', file: 'error-handler.json', publish: true, liveTrigger: false },
  { id: 'nbcProcessOrder1', name: 'Process order', file: 'process-order.json', publish: true, liveTrigger: false },
  { id: 'nbcIntakeOrder01', name: 'Intake order', file: 'intake-order.json', publish: true, liveTrigger: false },
  { id: 'nbcShopifyOrders', name: 'Shopify orders', file: 'shopify-orders.json', publish: true, liveTrigger: true },
  { id: 'nbcDevHarness001', name: 'Dev harness', file: 'dev-harness.json', publish: true, liveTrigger: false },
];

export const CREDENTIALS: readonly CredentialEntry[] = [
  {
    id: 'nbcCredAppDb0001',
    name: 'App DB',
    type: 'postgres',
    env: ['APP_DB_USER', 'APP_DB_PASSWORD'],
    data: (env) => ({
      host: 'postgres',
      port: 5432,
      database: 'app',
      user: readEnv(env, 'APP_DB_USER'),
      password: readEnv(env, 'APP_DB_PASSWORD'),
      ssl: 'disable',
    }),
  },
  {
    id: 'nbcCredShopify01',
    name: 'Shopify Admin',
    type: 'shopifyAccessTokenApi',
    env: ['SHOPIFY_STORE', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_CLIENT_SECRET'],
    data: (env) => ({
      shopSubdomain: readEnv(env, 'SHOPIFY_STORE'),
      accessToken: readEnv(env, 'SHOPIFY_ACCESS_TOKEN'),
      appSecretKey: readEnv(env, 'SHOPIFY_CLIENT_SECRET'),
    }),
  },
  {
    id: 'nbcCredGSheets01',
    name: 'Google Sheets',
    type: 'googleSheetsOAuth2Api',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    id: 'nbcCredGmail0001',
    name: 'Gmail',
    type: 'gmailOAuth2',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    data: (env) => ({ clientId: readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID'), clientSecret: readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET') }),
  },
  {
    // The dev harness is localhost-only, never exposed through the tunnel, and its workflow must
    // be unpublished before production. See AGENTS.md.
    id: 'nbcCredDevToken1',
    name: 'Dev harness token',
    type: 'httpHeaderAuth',
    env: ['DEV_HARNESS_TOKEN'],
    data: (env) => ({ name: 'X-Dev-Token', value: readEnv(env, 'DEV_HARNESS_TOKEN') }),
  },
];

export const CODE_NODES: readonly CodeNodeEntry[] = [
  {
    file: 'intake-order.json',
    node: 'Normalize order',
    source: 'src/nodes/normalize-order.ts',
    why: 'validates the Shopify payload and applies field fallbacks no Set node can express',
  },
  {
    file: 'intake-order.json',
    node: 'Check config',
    source: 'src/nodes/check-config.ts',
    why: 'validates the hand-edited config before any order is processed',
  },
  {
    file: 'process-order.json',
    node: 'Build order row',
    source: 'src/nodes/order-row.ts',
    why: 'joins line items and converts the timestamp to Bogota time',
  },
];
