import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { listJsonFiles } from '../scripts/lib/list-json-files.ts';
import type { WorkflowJson, WorkflowNode } from '../scripts/lib/workflow-types.ts';

const wf = (f: string) => JSON.parse(readFileSync(`workflows/${f}`, 'utf8')) as WorkflowJson;
const node = (f: string, name: string): WorkflowNode => {
  const n = wf(f).nodes.find((x) => x.name === name);
  if (!n) throw new Error(`${f}: no node ${name}`);
  return n;
};
const params = (f: string, name: string) => JSON.stringify(node(f, name).parameters);
const allWorkflows = () => listJsonFiles('workflows').map((path) => ({ file: basename(path), wf: JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson }));

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

it('the entry trigger is the HMAC-checking Shopify Trigger on orders/create', () => {
  const t = node('shopify-orders.json', 'Receive order');
  expect([t.type, t.webhookId, t.parameters.topic, t.parameters.authentication, t.credentials?.shopifyAccessTokenApi?.id])
    .toEqual(['n8n-nodes-base.shopifyTrigger', '4b1d2c3e-5f60-4a7b-8c9d-0e1f2a3b4c5d', 'orders/create', 'accessToken', 'nbcCredShopify01']);
});
it('the entry hands every order to intake-order, waiting, with no mapping and no retry', () => {
  const n = node('shopify-orders.json', 'Hand to intake');
  expect(JSON.stringify(n.parameters)).toContain('nbcIntakeOrder01');
  expect(n.parameters.options).toMatchObject({ waitForSubWorkflow: true });
  expect(n.parameters.workflowInputs).toBeUndefined();
  expect(n.retryOnFail).not.toBe(true);
});

it('the idempotency gate inserts on the primary key and tests the returned id', () => {
  expect(params('intake-order.json', 'Record order')).toContain('ON CONFLICT (order_id) DO NOTHING RETURNING order_id');
  const gate = node('intake-order.json', 'Is new order?').parameters;
  const conditions = gate.conditions as { conditions: { leftValue: string; operator: { operation: string } }[] };
  expect(conditions.conditions).toMatchObject([{ leftValue: '={{ $json.order_id }}', operator: { operation: 'notEmpty' } }]);
  expect(conditions.conditions).toHaveLength(1);
});
it('a new order reaches Load config and a duplicate reaches nothing else', () => {
  const connections = wf('intake-order.json').connections as Record<string, { main?: { node: string }[][] }>;
  const outputs = connections['Is new order?']?.main ?? [];
  expect(outputs[0]?.map((c) => c.node)).toEqual(['Load config']);
  expect(outputs[1] ?? []).toEqual([]);
});

it('the core runs without holding the entry execution', () => {
  const p = node('intake-order.json', 'Process order').parameters;
  expect(JSON.stringify(p)).toContain('nbcProcessOrder1');
  expect(p.options).toMatchObject({ waitForSubWorkflow: false });
});
it('Process order calls once per order and passes order and config as objects with nulls intact', () => {
  const n = node('intake-order.json', 'Process order');
  expect(n.parameters.mode).toBe('each');
  const inputs = n.parameters.workflowInputs as { attemptToConvertTypes?: boolean; convertFieldsToString?: boolean; value?: Record<string, string> };
  expect(inputs.attemptToConvertTypes).toBe(false);
  expect(inputs.convertFieldsToString).toBe(false);
  expect(inputs.value?.order).toContain("$('Normalize order').first().json");
  expect(inputs.value?.config).toBe('={{ $json.config }}');
});

it('every Postgres node across the workflows is pinned at 2.8 or later', () => {
  let seen = 0;
  for (const { file, wf: w } of allWorkflows()) {
    for (const n of w.nodes) {
      if (n.type === 'n8n-nodes-base.postgres') {
        seen += 1;
        expect(n.typeVersion, `${file} › ${n.name}`).toBeGreaterThanOrEqual(2.8);
      }
    }
  }
  expect(seen).toBeGreaterThan(0);
});
it('no Execute Workflow node retries, across all workflows', () => {
  let seen = 0;
  for (const { file, wf: w } of allWorkflows()) {
    for (const n of w.nodes) {
      if (n.type === 'n8n-nodes-base.executeWorkflow') {
        seen += 1;
        expect(n.retryOnFail, `${file} › ${n.name}`).not.toBe(true);
      }
    }
  }
  expect(seen).toBeGreaterThan(0);
});

it('the dev harness hands intake-order the order payload as the trigger would emit it', () => {
  const n = node('dev-harness.json', 'Call intake-order');
  expect(JSON.stringify(n.parameters)).toContain('nbcIntakeOrder01');
  expect(n.parameters.workflowInputs).toBeUndefined();
  expect(n.retryOnFail).not.toBe(true);

  const shape = node('dev-harness.json', 'Shape order item');
  expect(shape.parameters.mode).toBe('raw');
  expect(shape.parameters.jsonOutput).toBe('={{ $json.body.input }}');
  // includeOtherFields must not be true: it would leak the webhook's own headers, query, and body
  // wrapper onto the item instead of letting the raw order payload stand alone.
  expect(shape.parameters.includeOtherFields).not.toBe(true);

  const route = node('dev-harness.json', 'Route by target');
  const rules = (route.parameters.rules as { values: { outputKey: string }[] }).values;
  const intakeOrderOutputIndex = rules.findIndex((r) => r.outputKey === 'intake-order');
  expect(intakeOrderOutputIndex).toBeGreaterThanOrEqual(0);
  const connections = wf('dev-harness.json').connections as Record<string, { main?: { node: string }[][] }>;
  expect(connections['Route by target']?.main?.[intakeOrderOutputIndex]?.map((c) => c.node)).toEqual(['Shape order item']);
});
