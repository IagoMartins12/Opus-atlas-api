import { CATALOGS, type Catalog } from './catalogs';
import { SOURCE_LOCALE, type Locale, type TargetLocale } from './locale';

/**
 * Message translation, gettext style: the Portuguese text is the key.
 *
 * Fixed messages are a plain lookup. Messages with values in them are
 * written in the catalog as templates (`Obra com id "{0}" não encontrada`):
 * the Portuguese template becomes a pattern, the values it captures go into
 * the translated template, each one translated too when it is itself a
 * catalog entry. A message no catalog knows goes out as it is.
 */
interface Template {
  pattern: RegExp;
  target: string;
}

const PLACEHOLDER = /\{(\d+)\}/g;
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

function compile(catalog: Catalog): Template[] {
  return Object.entries(catalog)
    .filter(([source]) => /\{\d+\}/.test(source))
    .map(([source, target]) => {
      const pattern = escape(source).replace(/\{\d+\}/g, '(.+?)');
      return { pattern: new RegExp(`^${pattern}$`, 's'), target };
    });
}

const templates = new Map<Locale, Template[]>();
const templatesOf = (locale: TargetLocale) => {
  let list = templates.get(locale);
  if (!list) templates.set(locale, (list = compile(CATALOGS[locale])));
  return list;
};

export function translate(message: string, locale: Locale): string {
  if (locale === SOURCE_LOCALE || !message) return message;
  const catalog = CATALOGS[locale];
  const exact = catalog[message];
  if (exact !== undefined) return exact;
  for (const { pattern, target } of templatesOf(locale)) {
    const match = pattern.exec(message);
    if (match)
      return target.replace(PLACEHOLDER, (_, i: string) => {
        const value = match[Number(i) + 1] ?? '';
        return catalog[value] ?? value;
      });
  }
  return message;
}

export function translateMessage<T extends string | string[]>(
  message: T,
  locale: Locale,
): T {
  return (
    Array.isArray(message)
      ? message.map((m) => translate(m, locale))
      : translate(message, locale)
  ) as T;
}
