// Validates the config Load config just returned, before any order reaches Postgres, Sheets, or
// Gmail. The error handler loads this same config unvalidated, so checking it here — not there —
// keeps a bad hand-edit from silencing its own alert email. Pure: no I/O, no clock.
import { validateConfig, type Config } from '../lib/config.ts';

export interface CheckConfigInput {
  config: unknown;
}

export interface CheckConfigOutput {
  config: Config;
}

export function run(input: CheckConfigInput): CheckConfigOutput {
  return { config: validateConfig(input.config) };
}
