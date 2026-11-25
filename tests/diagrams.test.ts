import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_WORKFLOW_ID, WORKFLOWS } from '../scripts/lib/manifest.ts';

interface Component {
  readonly id: string;
  readonly type: string;
  readonly label: string;
}
interface Connection {
  readonly from: string;
  readonly to: string;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const workflowNames = WORKFLOWS.map((w) => w.file.replace('.json', '')).sort();

const architecture = readJson('docs/diagrams/architecture.json') as { components: Component[]; connections: Connection[] };
const sequence = readJson('docs/diagrams/order-sequence.json') as { participants: Component[] };

describe('diagrams follow the workflow manifest', () => {
  it('the architecture diagram draws every workflow in the manifest, by file name, and no other backend', () =>
    expect(architecture.components.filter((c) => c.type === 'backend').map((c) => c.label).sort()).toEqual(workflowNames));

  it('every backend participant in the sequence diagram is a workflow in the manifest', () => {
    const backends = sequence.participants.filter((p) => p.type === 'backend').map((p) => p.label);
    expect(backends.length).toBeGreaterThan(0);
    for (const label of backends) expect(workflowNames, label).toContain(label);
  });

  it('the architecture diagram routes every errorWorkflow user to error-handler', () => {
    const users = WORKFLOWS.filter((w) => {
      const workflow = readJson(`workflows/${w.file}`) as { settings?: { errorWorkflow?: string } };
      return workflow.settings?.errorWorkflow === ERROR_WORKFLOW_ID;
    }).map((w) => w.file.replace('.json', ''));
    expect(users.length).toBeGreaterThan(0);
    for (const id of users) {
      expect(architecture.connections.some((c) => c.from === id && c.to === 'error-handler'), id).toBe(true);
    }
  });
});

describe('every diagram source ships its rendered files', () => {
  const sources = ['architecture', 'order-sequence', 'order-lifecycle', 'data-flow'];
  const architectureDoc = readFileSync('docs/architecture.md', 'utf8');

  it.each(sources)('%s has its html and svg beside it', (name) => {
    expect(existsSync(`docs/diagrams/${name}.json`)).toBe(true);
    expect(existsSync(`docs/diagrams/${name}.html`)).toBe(true);
    expect(existsSync(`docs/diagrams/${name}.svg`)).toBe(true);
  });

  it.each(sources)('docs/architecture.md embeds %s.svg', (name) => expect(architectureDoc).toContain(`diagrams/${name}.svg`));
});
