import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv } from './lib/compose.ts';
import { waitForHealthy, waitForWebhookLive } from './lib/health.ts';
import { listJsonFiles } from './lib/list-json-files.ts';
import { WORKFLOWS, type WorkflowEntry } from './lib/manifest.ts';

const WORKFLOWS_DIR = 'workflows';

/**
 * Adds the command's stdout, because n8n's CLI prints its error detail there, not to stderr. It
 * never reads `.env`; this is the stdout of an `n8n` CLI invocation.
 */
function errorDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stdout = (err as { stdout?: unknown }).stdout;
  return typeof stdout === 'string' && stdout.trim() !== '' ? `${err.message}\n${stdout.trim()}` : err.message;
}

export async function importWorkflows(o: { live: boolean }): Promise<void> {
  loadDotEnv();

  const hasFiles = listJsonFiles(WORKFLOWS_DIR).length > 0;
  if (hasFiles) {
    await compose(['exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/workflows']);
  }

  const published: WorkflowEntry[] = [];
  const failures: string[] = [];
  for (const entry of WORKFLOWS) {
    const path = join(WORKFLOWS_DIR, entry.file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is WORKFLOWS_DIR + a manifest file name, not user input
    if (!existsSync(path)) {
      console.log(`skip ${entry.file} (missing)`);
      continue;
    }

    if (!entry.publish) continue;
    if (entry.liveTrigger && !o.live) {
      console.log(`skip publish ${entry.file} (live trigger)`);
      continue;
    }

    try {
      await compose(['exec', '-T', 'n8n', 'n8n', 'publish:workflow', `--id=${entry.id}`]);
      published.push(entry);
    } catch (err) {
      failures.push(`publish failed for ${entry.file}: ${errorDetail(err)}`);
    }
  }

  if (published.length > 0) {
    await compose(['restart', 'n8n']);
    const n8nUrl = process.env.N8N_URL;
    const healthy = n8nUrl ? await waitForHealthy(n8nUrl, 90_000) : false;
    if (!healthy) {
      failures.push('n8n did not become healthy after restart');
    } else {
      // NOTE: /healthz turns healthy before the publication reconciler syncs the published version
      // (every 10 s by default, N8N_WORKFLOW_PUBLICATION_RECONCILE_INTERVAL_SECONDS). This fixed
      // wait covers that default only; the webhook poll below is the real proof.
      await new Promise<void>((resolve) => setTimeout(resolve, 15_000));

      if (n8nUrl) {
        for (const entry of published) {
          if (!entry.webhookPath) continue;
          const live = await waitForWebhookLive(n8nUrl, entry.webhookPath, 60_000);
          if (!live) failures.push(`webhook for ${entry.file} never came up (still 404 after the wait)`);
        }
      }
    }
  }

  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--live');
  importWorkflows({ live }).catch((err: unknown) => {
    console.error(errorDetail(err));
    process.exitCode = 1;
  });
}
