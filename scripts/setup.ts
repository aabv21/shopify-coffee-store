import { assertSameStore, checkConfigFile } from './check-config.ts';
import { migrate } from './db-migrate.ts';
import { loadDotEnv } from './lib/compose.ts';
import { parseRefreshIds, setupCredentials } from './setup-credentials.ts';
import { importWorkflows } from './import-workflows.ts';

const CONFIG_PATH = 'config/config.json';

// One script, not `a && b`, so the `-- --live` / `-- --refresh <id>` flags reach both later steps.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const refresh = parseRefreshIds(args);

  // A bad config.json would reach every workflow, so stop before touching anything.
  const config = checkConfigFile(CONFIG_PATH);
  console.log('config OK');

  loadDotEnv();
  assertSameStore(config.shopify.store, process.env.SHOPIFY_STORE);
  await migrate();
  await setupCredentials({ refresh });
  await importWorkflows({ live });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
