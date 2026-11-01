import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SCOPES = ['read_orders', 'read_products', 'read_inventory'] as const;
export const REDIRECT_URI = 'https://127.0.0.1/shopify/callback';

export interface TokenResult {
  accessToken: string;
  scopes: string[];
  expiresIn: number | null;
}

const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/** The store's full shop domain. Throws if `store` isn't a bare myshopify subdomain. */
export function shopDomain(store: string): string {
  const domain = `${store}.myshopify.com`;
  if (!SHOP_RE.test(domain)) throw new Error('store must be the myshopify subdomain, e.g. "nubandina-demo"');
  return domain;
}

export function buildAuthorizeUrl(o: { store: string; clientId: string; state: string }): string {
  const url = new URL(`https://${shopDomain(o.store)}/admin/oauth/authorize`);
  url.searchParams.set('client_id', o.clientId);
  url.searchParams.set('scope', REQUIRED_SCOPES.join(','));
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('state', o.state);
  return url.toString();
}

/** Hex HMAC-SHA256 built like @shopify/shopify-api: sorted params minus `hmac`, form-encoded with
 * `+` as `%20`, so a base64 `host` (with `=`, `+` or `/`) hashes the way Shopify signed it. */
function computeCallbackHmac(params: URLSearchParams, clientSecret: string): string {
  const keys = [...new Set(params.keys())].filter((key) => key !== 'hmac').sort();
  const signed = new URLSearchParams();
  for (const key of keys) {
    for (const value of params.getAll(key)) signed.append(key, value);
  }
  const message = signed.toString().replace(/\+/g, '%20');
  return createHmac('sha256', clientSecret).update(message).digest('hex');
}

/** Validates a signed callback URL and returns the authorization code. */
export function parseCallbackUrl(url: string, o: { store: string; state: string; clientSecret: string }): string {
  const parsed = new URL(url);
  const params = parsed.searchParams;

  const received = params.get('hmac');
  if (!received) throw new Error('callback URL has no hmac parameter');
  const expected = computeCallbackHmac(params, o.clientSecret);
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    throw new Error('callback hmac does not match; the URL may have been tampered with');
  }

  if (params.get('state') !== o.state) throw new Error('callback state does not match the one we generated');

  const shop = params.get('shop');
  if (shop !== shopDomain(o.store)) throw new Error('callback shop does not match the configured store');

  const code = params.get('code');
  if (!code) throw new Error('callback URL has no code parameter');
  return code;
}

interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

function isTokenResponse(value: unknown): value is ShopifyTokenResponse {
  return typeof value === 'object' && value !== null && typeof (value as { access_token?: unknown }).access_token === 'string' && typeof (value as { scope?: unknown }).scope === 'string';
}

async function requestToken(store: string, body: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenResult> {
  const response = await fetchImpl(`https://${shopDomain(store)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCode = payload !== null && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : 'unknown error';
    throw new Error(`Shopify token request failed: ${String(response.status)} ${errorCode}`);
  }
  if (!isTokenResponse(payload)) throw new Error('Shopify token response had an unexpected shape');

  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : null;
  return { accessToken: payload.access_token, scopes: payload.scope.split(','), expiresIn };
}

/** Exchanges an authorization code for an offline access token. */
export function exchangeCode(o: { store: string; clientId: string; clientSecret: string; code: string }, fetchImpl: typeof fetch = fetch): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code });
  return requestToken(o.store, body, fetchImpl);
}

/** Fallback for a same-organization dev store: a client-credentials token that expires in 24 h. */
export function requestClientCredentialsToken(o: { store: string; clientId: string; clientSecret: string }, fetchImpl: typeof fetch = fetch): Promise<TokenResult> {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: o.clientId, client_secret: o.clientSecret });
  return requestToken(o.store, body, fetchImpl);
}

/** Throws if `granted` isn't exactly the required read scopes, naming the first mismatch found. */
export function checkScopes(granted: readonly string[]): void {
  const grantedSet = new Set(granted);
  for (const scope of REQUIRED_SCOPES) {
    if (!grantedSet.has(scope)) throw new Error(`missing ${scope}`);
  }
  const requiredSet = new Set<string>(REQUIRED_SCOPES);
  for (const scope of granted) {
    if (!requiredSet.has(scope)) throw new Error(`extra ${scope}`);
  }
}

/** Sets `key=value` in `.env`-style text, replacing an existing line or appending a new one. */
export function upsertEnv(text: string, key: string, value: string): string {
  const lines = text.split('\n');
  const trailingNewline = text.endsWith('\n');
  if (trailingNewline) lines.pop();

  const prefix = `${key}=`;
  const found = lines.some((line) => line.startsWith(prefix));
  const updated = lines.map((line) => (line.startsWith(prefix) ? `${prefix}${value}` : line));
  if (!found) updated.push(`${prefix}${value}`);

  return `${updated.join('\n')}\n`;
}

/**
 * Writes `.env` text atomically at mode 0600. `.env` holds `N8N_ENCRYPTION_KEY`; a write that's
 * interrupted partway through must never leave a truncated file, which would lose every stored
 * n8n credential. Writes to a tmp file first (chmod'd 0600 even if a stale tmp file already
 * existed at a looser mode), then renames it over the target in one step.
 */
export function writeEnvFile(path: string, text: string): void {
  const tmpPath = `${path}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  writeFileSync(tmpPath, text, { mode: 0o600 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  chmodSync(tmpPath, 0o600);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  renameSync(tmpPath, path);
}

function describeExpiry(expiresIn: number | null): string {
  return expiresIn === null ? 'never' : 'in 24 h';
}

async function readCallbackUrlFromStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  console.log('Paste the full address-bar URL the browser failed to load, then press Enter:');
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed) return trimmed;
    }
    throw new Error('no callback URL was provided on stdin');
  } finally {
    rl.close();
  }
}

async function runAuthorizationCodeFlow(o: { store: string; clientId: string; clientSecret: string }): Promise<TokenResult> {
  const state = randomBytes(16).toString('hex');
  console.log('Open this URL, sign in, and approve access:');
  console.log(buildAuthorizeUrl({ store: o.store, clientId: o.clientId, state }));
  console.log(`The browser will then fail to load ${REDIRECT_URI}?... on purpose — that's expected.`);

  const callbackUrl = await readCallbackUrlFromStdin();
  const code = parseCallbackUrl(callbackUrl, { store: o.store, state, clientSecret: o.clientSecret });
  return exchangeCode({ store: o.store, clientId: o.clientId, clientSecret: o.clientSecret, code });
}

async function runClientCredentialsFlow(o: { store: string; clientId: string; clientSecret: string }): Promise<TokenResult> {
  console.warn('Using the client-credentials fallback: the token expires in 24 h.');
  console.warn('Re-run daily: npm run shopify:token -- --client-credentials, then npm run setup -- --refresh nbcCredShopify01 --live.');
  return requestClientCredentialsToken(o);
}

export async function runShopifyToken(o: { clientCredentials: boolean; envPath: string }): Promise<void> {
  process.loadEnvFile(o.envPath);
  const store = process.env.SHOPIFY_STORE;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!store || !clientId || !clientSecret) {
    throw new Error('SHOPIFY_STORE, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET must all be set in .env');
  }

  const result = o.clientCredentials
    ? await runClientCredentialsFlow({ store, clientId, clientSecret })
    : await runAuthorizationCodeFlow({ store, clientId, clientSecret });

  checkScopes(result.scopes);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- envPath is the caller-provided .env path, not user input
  const current = readFileSync(o.envPath, 'utf8');
  writeEnvFile(o.envPath, upsertEnv(current, 'SHOPIFY_ACCESS_TOKEN', result.accessToken));

  const scopes = [...result.scopes].sort().join(', ');
  console.log(`Saved SHOPIFY_ACCESS_TOKEN (scopes: ${scopes}; expires: ${describeExpiry(result.expiresIn)})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const clientCredentials = process.argv.includes('--client-credentials');
  runShopifyToken({ clientCredentials, envPath: '.env' }).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
