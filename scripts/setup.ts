import { checkConfigFile } from './check-config.ts';
import { migrate } from './db-migrate.ts';
import { loadDotEnv } from './lib/compose.ts';
import { parseRefreshIds, setupCredentials } from './setup-credentials.ts';
import { importWorkflows } from './import-workflows.ts';

const CONFIG_PATH = 'config/config.json';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const refresh = parseRefreshIds(args);

  // A bad config.json would reach every workflow that loads it; stop before touching the
  // database, credentials, or workflows at all.
  checkConfigFile(CONFIG_PATH);
  console.log('config OK');

  loadDotEnv();
  await migrate();
  await setupCredentials({ refresh });
  await importWorkflows({ live });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
