// The languages this store speaks, and the one helper that maps any incoming locale tag onto
// them. Pure: no I/O, no Node imports, because Code nodes bundle it.

export const LOCALES = ['en', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Maps a locale tag such as `es-CO`, `es_CO`, `ES`, or `en-US` to its supported language, by its
 * primary subtag. Anything else (another language, a malformed tag, a missing value) returns
 * `fallback`.
 */
export function normalizeLocale<F extends Locale | null>(value: unknown, fallback: F): Locale | F {
  if (typeof value !== 'string') return fallback;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(language) ? language : fallback;
}
