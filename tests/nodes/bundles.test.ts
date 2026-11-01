import { expect, it } from 'vitest';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { runCodeNode } from '../lib/code-node.ts';
import { fx } from '../lib/orders.ts';

it('the committed Normalize order node behaves like its source', () =>
  expect(runCodeNode('intake-order.json', 'Normalize order', fx('two-methods'))).toEqual([{ json: normalize(fx('two-methods')) }]));

it('the committed Check config node passes a valid config through unchanged', () => {
  const config = { owner_email: 'owner@example.com', google: { orders_sheet_id: 'sheet1', orders_tab: 'Orders' }, shopify: { store: 'nubandina-demo', api_version: '2026-10' }, low_stock_threshold: 5, guide_delay_minutes: 60 };
  expect(runCodeNode('intake-order.json', 'Check config', { config })).toEqual([{ json: { config } }]);
});
it('the committed Check config node throws the validator message for an invalid config', () => {
  expect(() => runCodeNode('intake-order.json', 'Check config', { config: {} })).toThrow('owner_email must be an email address');
});
