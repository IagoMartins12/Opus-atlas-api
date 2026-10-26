/**
 * The popular names of works ("Sonata ao Luar" for Piano Sonata No.14,
 * Op.27 No.2): an editorial list (`prisma/data/popular-names.json`) matched
 * to the catalog. Pure, so the matching is tested apart from the database.
 *
 * Each entry names the composer by the end of the IMSLP page
 * ("(Beethoven,_Ludwig_van)"), which is exact — "Bach" alone is six
 * composers — and the work by a pattern on its title. An arrangement by
 * someone else lives on a page that ends with the arranger's name, so it is
 * never matched.
 */
export interface PopularNameEntry {
  /** The composer as IMSLP writes the page suffix: "Beethoven,_Ludwig_van". */
  c: string;
  /** A pattern on the work title (case aside). */
  t: string;
  /** The work's popular name; `null` when people know it by its title. */
  pt: string | null;
  en: string | null;
  /** Its famous parts, by the name people search (Clair de Lune). */
  partes?: { pt: string[]; en: string[] };
}

export interface CatalogWork {
  id: string;
  title: string;
  imslpPermlink: string;
  popularName: string | null;
  popularNameEn: string | null;
  famousParts: string[];
  famousPartsEn: string[];
}

export interface PopularNameMatch {
  entry: PopularNameEntry;
  works: CatalogWork[];
}

/** Over this many works, a pattern is probably too loose: it is reported. */
export const TOO_MANY = 4;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Whether the work's IMSLP page belongs to this composer (not an arranger). */
export const isComposersPage = (permlink: string, composer: string) =>
  decode(permlink.trim()).endsWith(`(${composer})`);

export function matchPopularNames(
  entries: PopularNameEntry[],
  worksOf: (composer: string) => CatalogWork[],
): PopularNameMatch[] {
  return entries.map((entry) => {
    const pattern = new RegExp(entry.t, 'i');
    return {
      entry,
      works: worksOf(entry.c).filter(
        (w) =>
          isComposersPage(w.imslpPermlink, entry.c) && pattern.test(w.title),
      ),
    };
  });
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

type Changes = {
  popularName?: string | null;
  popularNameEn?: string | null;
  famousParts?: string[];
  famousPartsEn?: string[];
};

/**
 * What to write on a work: each name (unless it is the title itself — Prince
 * Igor needs no English popular name) and the famous parts. What the work
 * already has (a curator's edit) is kept; `force` overrides.
 */
export function changesFor(
  work: CatalogWork,
  entry: PopularNameEntry,
  force = false,
): Changes {
  const changes: Changes = {};
  const nome = (
    novo: string | null,
    atual: string | null,
    key: 'popularName' | 'popularNameEn',
  ) => {
    const valor = novo && !same(novo, work.title) ? novo : null;
    if (valor === (atual ?? null) || !valor) return;
    if (atual && !force) return;
    changes[key] = valor;
  };
  const partes = (
    novas: string[] | undefined,
    atuais: string[],
    key: 'famousParts' | 'famousPartsEn',
  ) => {
    if (!novas?.length) return;
    if (novas.join('|') === atuais.join('|')) return;
    if (atuais.length && !force) return;
    changes[key] = novas;
  };
  nome(entry.pt, work.popularName, 'popularName');
  nome(entry.en, work.popularNameEn, 'popularNameEn');
  partes(entry.partes?.pt, work.famousParts, 'famousParts');
  partes(entry.partes?.en, work.famousPartsEn, 'famousPartsEn');
  return changes;
}
