import { afterEach, expect, it, vi } from 'vitest';
import { CREDENTIALS } from '../../scripts/lib/manifest.ts';

const composeMock = vi.fn<(args: readonly string[], opts?: { input?: string }) => Promise<{ stdout: string; stderr: string }>>();
vi.mock('../../scripts/lib/compose.ts', () => ({ compose: composeMock, loadDotEnv: vi.fn() }));

const { buildImportCall, EXPORT_SCRIPT, existingCredentialIds, IMPORT_SCRIPT, planCredentialImport } = await import('../../scripts/setup-credentials.ts');

afterEach(() => {
  composeMock.mockReset();
});

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

it('buildImportCall streams the credential JSON over stdin, never as a file argument', () => {
  const toImport = [{ id: 'nbcCredAppDb0001', name: 'App DB', type: 'postgres', data: { user: 'app' } }];
  const call = buildImportCall(toImport);
  expect(call.args).toEqual(['exec', '-T', 'n8n', 'sh', '-c', IMPORT_SCRIPT]);
  expect(call.input).toBe(JSON.stringify(toImport));
  expect(call.args.join(' ')).not.toContain('credentials.json');
});

it('IMPORT_SCRIPT sets a strict umask, uses its own temp file, and cleans up on both outcomes', () => {
  expect(IMPORT_SCRIPT).toContain('umask 077');
  expect(IMPORT_SCRIPT).toContain('mktemp');
  expect(IMPORT_SCRIPT).toContain('n8n import:credentials --input="$tmp"');
  expect(IMPORT_SCRIPT).toContain('rm -f "$tmp"');
  expect(IMPORT_SCRIPT).toContain('exit $status');
});

it('EXPORT_SCRIPT sets a strict umask, uses its own temp file, sends n8n\'s own output to stderr, and only cats on success', () => {
  expect(EXPORT_SCRIPT).toContain('umask 077');
  expect(EXPORT_SCRIPT).toContain('mktemp');
  expect(EXPORT_SCRIPT).toContain('n8n export:credentials --all --output="$tmp" >&2');
  expect(EXPORT_SCRIPT).toContain('cat "$tmp"');
  expect(EXPORT_SCRIPT).toContain('rm -f "$tmp"');
  expect(EXPORT_SCRIPT).toContain('exit $status');
});

it('existingCredentialIds runs EXPORT_SCRIPT and parses the ids from stdout, never a file', async () => {
  composeMock.mockResolvedValue({ stdout: JSON.stringify([{ id: 'nbcCredAppDb0001' }, { id: 'nbcCredDevToken1' }]), stderr: 'Acquiring database migration lock...\nSuccessfully exported 2 credentials.' });
  const ids = await existingCredentialIds();
  expect(composeMock).toHaveBeenCalledWith(['exec', '-T', 'n8n', 'sh', '-c', EXPORT_SCRIPT]);
  expect(ids).toEqual(new Set(['nbcCredAppDb0001', 'nbcCredDevToken1']));
});

it('existingCredentialIds returns an empty set when n8n reports no credentials yet, on either stream', async () => {
  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: '', stderr: 'No credentials found' }));
  expect(await existingCredentialIds()).toEqual(new Set());

  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: 'No credentials found', stderr: '' }));
  expect(await existingCredentialIds()).toEqual(new Set());
});

it('existingCredentialIds rethrows any other failure', async () => {
  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: '', stderr: 'permission denied' }));
  await expect(existingCredentialIds()).rejects.toThrow('exit 1');
});

it('existingCredentialIds throws a fixed message, not the unparseable export, when stdout is not JSON', async () => {
  const corruptStdout = 'Acquiring database migration lock...\n{"id":"nbcCredAppDb0001", truncated';
  composeMock.mockResolvedValue({ stdout: corruptStdout, stderr: '' });
  await expect(existingCredentialIds()).rejects.toThrow('could not parse the credential listing from n8n export:credentials');
  await expect(existingCredentialIds()).rejects.not.toThrow(/nbcCredAppDb0001|truncated|migration lock/);
});
