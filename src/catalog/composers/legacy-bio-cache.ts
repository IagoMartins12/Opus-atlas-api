/**
 * O `public/translations/composers-bio.json` do legado — onde ficavam as
 * biografias em inglês, e cópias das em português.
 *
 * Formato: `{ ptBr: { "<nome_limpo>_<composerId>": texto }, en: { ... } }`.
 * A chave termina no id do compositor; o nome antes dele não importa.
 */
export interface LegacyBioCache {
  ptBr?: Record<string, unknown>;
  en?: Record<string, unknown>;
}

export interface LegacyBios {
  pt?: string;
  en?: string;
}

const ID_AT_END = /([0-9a-f]{24})$/i;

export function parseLegacyBioCache(
  cache: LegacyBioCache,
): Map<string, LegacyBios> {
  const bios = new Map<string, LegacyBios>();

  const collect = (
    entries: Record<string, unknown> | undefined,
    lang: 'pt' | 'en',
  ) => {
    for (const [key, value] of Object.entries(entries ?? {})) {
      const id = ID_AT_END.exec(key)?.[1]?.toLowerCase();
      const text = typeof value === 'string' ? value.trim() : '';

      if (!id || !text) continue;

      bios.set(id, { ...bios.get(id), [lang]: text });
    }
  };

  collect(cache.ptBr, 'pt');
  collect(cache.en, 'en');

  return bios;
}
