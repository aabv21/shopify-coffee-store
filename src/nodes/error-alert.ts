// The error handler loads config unvalidated, so nothing here may throw: a missing or malformed
// value falls back to English or an empty string, never a second failure that silences the alert.
import { normalizeLocale, type Locale } from '../lib/locale.ts';

export interface ErrorAlertInput {
  /** The Error Trigger's item: `execution` for a failed run, `trigger` for an activation error. */
  error: unknown;
  /** `config.team_locale`, unvalidated. */
  team_locale?: unknown;
  /** The time of the alert, already formatted in America/Bogota. */
  time: string;
}

export interface ErrorAlert {
  subject: string;
  text: string;
}

interface Messages {
  subject: (workflowName: string) => string;
  failedNode: string;
  activation: string;
  error: string;
  execution: string;
  noExecution: string;
  time: string;
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    subject: (workflowName) => `[Nubandina demo] Workflow failed: ${workflowName}`,
    failedNode: 'Failed node',
    activation: 'activation',
    error: 'Error',
    execution: 'Execution',
    noExecution: 'n/a (activation error)',
    time: 'Time',
  },
  es: {
    subject: (workflowName) => `[Nubandina demo] Falló el flujo: ${workflowName}`,
    failedNode: 'Nodo que falló',
    activation: 'activación',
    error: 'Error',
    execution: 'Ejecución',
    noExecution: 'n/d (error de activación)',
    time: 'Hora',
  },
};

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return new Map(Object.entries(value)).get(key);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function run(input: ErrorAlertInput): ErrorAlert {
  const m = MESSAGES[normalizeLocale(input.team_locale, 'en')];
  const execution = field(input.error, 'execution');
  const workflowName = text(field(field(input.error, 'workflow'), 'name')) ?? '';
  const message = text(field(field(execution, 'error'), 'message')) ?? text(field(field(field(input.error, 'trigger'), 'error'), 'message')) ?? '';

  return {
    subject: m.subject(workflowName),
    text: [
      `${m.failedNode}: ${text(field(execution, 'lastNodeExecuted')) ?? m.activation}`,
      `${m.error}: ${message}`,
      `${m.execution}: ${text(field(execution, 'url')) ?? m.noExecution}`,
      `${m.time}: ${input.time} America/Bogota`,
    ].join('\n'),
  };
}
