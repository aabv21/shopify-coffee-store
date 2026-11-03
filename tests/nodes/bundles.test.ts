import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { run as normalize } from '../../src/nodes/normalize-order.ts';
import { run as buildOrderRow } from '../../src/nodes/order-row.ts';
import { run as selectLowStock } from '../../src/nodes/select-low-stock.ts';
import { run as selectGuides } from '../../src/nodes/select-guides.ts';
import { run as ownerSummary } from '../../src/nodes/owner-summary.ts';
import { run as errorAlert } from '../../src/nodes/error-alert.ts';
import type { BrewingGuides } from '../../src/nodes/types.ts';
import { runCodeNode } from '../lib/code-node.ts';
import { fx } from '../lib/orders.ts';

const stock = (n: string): unknown => JSON.parse(readFileSync(`tests/fixtures/stock/${n}.json`, 'utf8'));
const guides = JSON.parse(readFileSync('data/brewing-guides.json', 'utf8')) as BrewingGuides;

it('the committed Normalize order node behaves like its source', () => {
  expect(runCodeNode('intake-order.json', 'Normalize order', fx('two-methods'))).toEqual([{ json: normalize(fx('two-methods')) }]);
  expect(runCodeNode('intake-order.json', 'Normalize order', fx('two-methods-es'))).toMatchObject([{ json: { locale: 'es' } }]);
});

it('the committed Build order row node behaves like its source', () => {
  const input = { order: normalize(fx('free-shipping')) };
  expect(runCodeNode('process-order.json', 'Build order row', input)).toEqual([{ json: buildOrderRow(input) }]);
});

it('the committed Check config node passes a valid config through unchanged', () => {
  const config = { owner_email: 'owner@example.com', google: { orders_sheet_id: 'sheet1', orders_tab: 'Orders' }, shopify: { store: 'nubandina-demo', api_version: '2026-10' }, low_stock_threshold: 5, guide_delay_minutes: 60, default_locale: 'es', team_locale: 'en' };
  expect(runCodeNode('intake-order.json', 'Check config', { config })).toEqual([{ json: { config } }]);
});
it('the committed Check config node defaults a config from before the locale keys to English', () => {
  const config = { owner_email: 'owner@example.com', google: { orders_sheet_id: 'sheet1', orders_tab: 'Orders' }, shopify: { store: 'nubandina-demo', api_version: '2026-10' }, low_stock_threshold: 5, guide_delay_minutes: 60 };
  expect(runCodeNode('intake-order.json', 'Check config', { config })).toEqual([{ json: { config: { ...config, default_locale: 'en', team_locale: 'en' } } }]);
});
it('the committed Check config node throws the validator message for an invalid config', () => {
  expect(() => runCodeNode('intake-order.json', 'Check config', { config: {} })).toThrow('owner_email must be an email address');
});

it('the committed Select low-stock variants node behaves like its source', () => {
  const input = { order: normalize(fx('low-stock')), response: stock('sierra-500-at-4'), threshold: 5 };
  expect(runCodeNode('process-order.json', 'Select low-stock variants', input)).toEqual([{ json: selectLowStock(input) }]);
});

it('the committed Build guide email node behaves like its source', () => {
  const order = normalize(fx('two-methods'));
  const variants = selectLowStock({ order, response: stock('two-methods'), threshold: 5 }).variants;
  const input = { order, variants, guides };
  expect(runCodeNode('process-order.json', 'Build guide email', input)).toEqual([{ json: selectGuides(input) }]);
});

it('the committed Build guide email node writes Spanish for a Spanish order', () => {
  const order = normalize(fx('two-methods-es'));
  const variants = selectLowStock({ order, response: stock('two-methods'), threshold: 5 }).variants;
  const input = { order, variants, guides, default_locale: 'en' };
  expect(runCodeNode('process-order.json', 'Build guide email', input)).toEqual([{ json: selectGuides(input) }]);
  expect(selectGuides(input).subject).toBe('Cómo preparar su café Nubandina');
});

it('the committed Build owner summary node behaves like its source', () => {
  const input = { row: buildOrderRow({ order: normalize(fx('two-methods')) }), team_locale: 'es' };
  expect(runCodeNode('process-order.json', 'Build owner summary', input)).toEqual([{ json: ownerSummary(input) }]);
  expect(ownerSummary(input).subject).toBe('Nuevo pedido #T1004: 96.000 COP');
});

it('the committed Build error alert node behaves like its source', () => {
  const input = { error: { workflow: { name: 'Process order' }, trigger: { error: { message: 'boom' } } }, team_locale: 'es', time: '2026-11-04 09:05' };
  expect(runCodeNode('error-handler.json', 'Build error alert', input)).toEqual([{ json: errorAlert(input) }]);
});
