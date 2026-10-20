/**
 * The languages the API answers in. Portuguese is the source: every message
 * is written in it, and it is the key of the other catalogs (`catalogs/`).
 * A new language is a new catalog plus an entry here.
 */
export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const SOURCE_LOCALE = 'pt' satisfies Locale;
export type TargetLocale = Exclude<Locale, typeof SOURCE_LOCALE>;

const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/**
 * The language of a request, from `Accept-Language` (`en-US,en;q=0.9,pt;q=0.8`):
 * the supported language with the highest weight, Portuguese otherwise.
 */
export function localeFromHeader(
  header: string | string[] | undefined,
): Locale {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const ranked = raw
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        lang: tag.trim().toLowerCase().split('-')[0],
        weight: q ? Number(q.trim().slice(2)) || 0 : 1,
      };
    })
    .filter((entry) => entry.lang && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  return (
    (ranked.find((entry) => isLocale(entry.lang))?.lang as Locale) ??
    SOURCE_LOCALE
  );
}
