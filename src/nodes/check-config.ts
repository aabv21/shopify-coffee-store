// Validated here, not in Load config: the error handler loads the same file unvalidated, so a bad
// hand-edit still gets its alert email.
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
