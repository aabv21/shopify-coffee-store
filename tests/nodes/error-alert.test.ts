import { expect, it } from 'vitest';
import { run } from '../../src/nodes/error-alert.ts';

const failedRun = {
  execution: { id: '42', url: 'http://localhost:5678/workflow/nbcProcessOrder1/executions/42', lastNodeExecuted: 'Upsert order row', error: { message: 'Sheet with name Orders not found' } },
  workflow: { id: 'nbcProcessOrder1', name: 'Process order' },
};
const activationFailure = { workflow: { id: 'nbcShopifyOrders', name: 'Shopify orders' }, trigger: { error: { message: 'Invalid credentials' } } };
const time = '2026-11-04 09:05';

it('alerts in English, exactly as the error email always read', () =>
  expect(run({ error: failedRun, team_locale: 'en', time })).toEqual({
    subject: '[Nubandina demo] Workflow failed: Process order',
    text: [
      'Failed node: Upsert order row',
      'Error: Sheet with name Orders not found',
      'Execution: http://localhost:5678/workflow/nbcProcessOrder1/executions/42',
      'Time: 2026-11-04 09:05 America/Bogota',
    ].join('\n'),
  }));

it('names an activation error, which has no execution', () =>
  expect(run({ error: activationFailure, team_locale: 'en', time }).text).toBe(
    ['Failed node: activation', 'Error: Invalid credentials', 'Execution: n/a (activation error)', 'Time: 2026-11-04 09:05 America/Bogota'].join('\n'),
  ));

it('alerts in Spanish when the team reads Spanish', () => {
  expect(run({ error: failedRun, team_locale: 'es', time })).toEqual({
    subject: '[Nubandina demo] Falló el flujo: Process order',
    text: [
      'Nodo que falló: Upsert order row',
      'Error: Sheet with name Orders not found',
      'Ejecución: http://localhost:5678/workflow/nbcProcessOrder1/executions/42',
      'Hora: 2026-11-04 09:05 America/Bogota',
    ].join('\n'),
  });
  expect(run({ error: activationFailure, team_locale: 'es', time }).text).toContain('Nodo que falló: activación\n');
  expect(run({ error: activationFailure, team_locale: 'es', time }).text).toContain('Ejecución: n/d (error de activación)\n');
});

// The error handler loads config unvalidated, so a missing or hand-broken team_locale must still
// produce an alert rather than a second failure that silences it.
it('never throws on a missing or malformed locale or error payload', () => {
  for (const team_locale of [undefined, '', 'fr', 'es-CO']) {
    const input = { error: failedRun, time, ...(team_locale === undefined ? {} : { team_locale }) };
    expect(run(input).subject).toMatch(/^\[Nubandina demo\] /);
  }
  expect(run({ error: failedRun, team_locale: 'es-CO', time }).subject).toBe('[Nubandina demo] Falló el flujo: Process order');
  expect(run({ error: null, time }).text).toBe(['Failed node: activation', 'Error: ', 'Execution: n/a (activation error)', 'Time: 2026-11-04 09:05 America/Bogota'].join('\n'));
  expect(run({ error: 'oops', team_locale: 'es', time }).subject).toBe('[Nubandina demo] Falló el flujo: ');
});
