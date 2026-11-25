// No Node imports: Code nodes bundle this.

/** The store's time zone: order dates, alert times and every workflow's `settings.timezone`. */
export const STORE_TIMEZONE = 'America/Bogota';

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

/** The entry of a per-locale message table for a locale tag, or for `fallback` when the tag isn't supported. */
export function messagesFor<T>(table: Readonly<Record<Locale, T>>, raw: unknown, fallback: Locale = 'en'): T {
  return table[normalizeLocale(raw, fallback)];
}
