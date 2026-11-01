import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { WorkflowJson, WorkflowNode } from '../scripts/lib/workflow-types.ts';

const wf = (f: string) => JSON.parse(readFileSync(`workflows/${f}`, 'utf8')) as WorkflowJson;
const node = (f: string, name: string): WorkflowNode => {
  const n = wf(f).nodes.find((x) => x.name === name);
  if (!n) throw new Error(`${f}: no node ${name}`);
  return n;
};
const params = (f: string, name: string) => JSON.stringify(node(f, name).parameters);

it('load-config reads the mounted config file', () => expect(params('load-config.json', 'Read config file')).toContain('/files/config/config.json'));
it('load-config accepts all caller data on its trigger', () => expect(params('load-config.json', 'When called')).toContain('"inputSource":"passthrough"'));
it('load-config reads the config file loudly instead of silently skipping a missing one', () => {
  const n = node('load-config.json', 'Read config file');
  expect(n.alwaysOutputData).toBe(true);
  expect(n.executeOnce).toBe(true);
});

it('error emails reach the owner and cover activation errors', () => {
  const p = params('error-handler.json', 'Email owner');
  expect(p).toContain('config.owner_email');
  expect(p).toContain("execution?.lastNodeExecuted ?? 'activation'");
  expect(p).toContain('execution?.error?.message ?? trigger?.error?.message');
  expect(p).toContain("execution?.url ?? 'n/a (activation error)'");
  expect(p).toContain('"appendAttribution":false');
});
