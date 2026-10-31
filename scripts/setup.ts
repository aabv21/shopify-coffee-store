import { parseRefreshIds, setupCredentials } from './setup-credentials.ts';
import { importWorkflows } from './import-workflows.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const refresh = parseRefreshIds(args);

  await setupCredentials({ refresh });
  await importWorkflows({ live });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
