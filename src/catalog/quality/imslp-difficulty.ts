/**
 * Dificuldade curada do IMSLP: o Difficulty Project
 * (`https://imslp.org/wiki/IMSLP:Difficulty`), listas por instrumento em que
 * professores e músicos dão a cada obra (ou trecho dela) um nível de 1 a 15,
 * equivalente aos níveis do RCM: 1 é o preparatório, 2 a 11 são os níveis 1 a
 * 10, 12 é o ARCT, 15 o mais difícil já escrito para o instrumento.
 *
 * **Por que só ela.** A dificuldade que o acervo tinha era palpite da
 * raspagem (número de opus, palavras no título): os estudos de Chopin como
 * iniciante, 80 mil obras como intermediário porque nada decidia. Decisão do
 * dono (31/10): fica só o que alguém curou — esta lista, ou quem edita no
 * painel. Obra sem nível fica sem nível.
 */

/** `Work.difficultySystem` de quem edita no painel: a importação não o sobrescreve. */
export const CURATED_SYSTEM = 'OPUS_ATLAS';
/** `Work.difficultySystem` do nível que veio do Difficulty Project. */
export const IMSLP_SYSTEM = 'IMSLP';

/** As listas do projeto, na ordem das páginas `Special:DiffPage/DiffMain/<n>`. */
export const DIFFICULTY_LISTS: ReadonlyArray<{
  page: number;
  instrument: string;
}> = [
  { page: 1, instrument: 'Piano' },
  { page: 2, instrument: 'Violino' },
  { page: 3, instrument: 'Violoncelo' },
  { page: 4, instrument: 'Flauta' },
  { page: 5, instrument: 'Clarinete' },
  { page: 6, instrument: 'Trompete' },
  { page: 7, instrument: 'Flauta Doce' },
  { page: 8, instrument: 'Harpa' },
  { page: 9, instrument: 'Trompa' },
  { page: 10, instrument: 'Violão' },
  { page: 11, instrument: 'Saxofone' },
  { page: 12, instrument: 'Oboé' },
  { page: 13, instrument: 'Órgão' },
  { page: 14, instrument: 'Contrabaixo' },
];

/** O que guardamos de uma entrada da lista. */
export interface DifficultyEntry {
  /** Número da entrada no projeto (único entre todas as listas). */
  entryId: number;
  /** Instrumento da lista, como o acervo o chama. */
  instrument: string;
  /** 1–15. */
  level: number;
  /** Título da página da obra no IMSLP; ausente quando a lista só dá o arquivo. */
  page: string | null;
  /** Arquivos (`IMSLP #...`) que a entrada avalia. */
  fileIds: string[];
  /** O trecho avaliado ("7. On the River Bank"); `null` é a obra inteira. */
  excerpt: string | null;
  /** As páginas do trecho no arquivo ("p.9", "pp.7-14"). */
  pages: string | null;
  /** A referência que a entrada cita ("RCM (2008) Preparatory B"). */
  reference: string | null;
}

type Json = unknown;
const isArr = (v: Json): v is Json[] => Array.isArray(v);
const clean = (v: Json) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim() || null;

/** Rótulo de arquivo que cobre a obra toda: partitura completa ou uma parte. */
const WHOLE_FILE =
  /^complete\b|\bparts?$|^imslp #|^(violin|viola|cello|flute|oboe|clarinet|horn|trumpet|cornet|recorder|saxophone|double bass|harp|guitar|organ|piano)( solo)?( \(.*\))?$/i;
const isPieceLabel = (label: string | null) =>
  !!label && !WHOLE_FILE.test(label);

/**
 * As entradas de uma página de lista. Os dados vêm num objeto JavaScript da
 * própria página (`f1t<n>={"data":[...],"colids":[...]}`), uma linha por
 * entrada, nas colunas de `colids` (`updvote`, `lvl`, `work`, `files`...).
 * Entrada fora do formato é pulada, não derruba a lista.
 */
export function parseDifficultyPage(
  html: string,
  instrument: string,
): DifficultyEntry[] {
  const match = /f1t\d+=(\{"data":[\s\S]*?"colids":\[[^\]]*\]\});/.exec(html);
  if (!match) return [];
  const { data } = JSON.parse(match[1]) as { data: Json[] };
  const out: DifficultyEntry[] = [];
  for (const row of data) {
    if (!isArr(row) || !isArr(row[0]) || !isArr(row[1]) || !isArr(row[2]))
      continue;
    const entryId = Number(row[0][0]);
    const level = Number(row[1][2]);
    if (!Number.isInteger(entryId) || !(level >= 1 && level <= 15)) continue;

    const work = row[2];
    const page =
      isArr(work[1]) && typeof work[1][0] === 'string' ? work[1][0] : null;
    const meta = isArr(work[3]) && isArr(work[3][0]) ? work[3][0] : [];
    const comment = meta.find(
      (m): m is [string, string] => isArr(m) && m[0] === 'Comment',
    );

    const files = isArr(row[3]) && isArr(row[3][0]) ? row[3][0] : [];
    const fileIds: string[] = [];
    let excerpt: string | null = null;
    let pages: string | null = null;
    for (const file of files) {
      if (!isArr(file)) continue;
      fileIds.push(String(file[0]));
      // The excerpt is `[title]`, `[pages, title]` or
      // `[from, to, pages, title]`; a file that is itself a piece of the work
      // says so in its label ("5. Seguidillas").
      const part = file[4];
      if (isArr(part) && part.length >= 1 && !excerpt) {
        excerpt = clean(part[part.length - 1]);
        pages = part.length >= 2 ? clean(part[part.length - 2]) : null;
      } else if (!isArr(part) && !excerpt && isPieceLabel(clean(file[1]))) {
        excerpt = clean(file[1]);
      }
    }

    out.push({
      entryId,
      instrument,
      level,
      page,
      fileIds,
      excerpt,
      pages,
      reference: comment?.[1]?.trim() || null,
    });
  }
  return out;
}

export type DifficultyTier = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

/**
 * O nível do IMSLP nos três do acervo, pelos grupos do próprio RCM:
 * elementar até o nível 4 (IMSLP 1–5), intermediário do 5 ao 8 (IMSLP 6–9),
 * avançado do 9 em diante, ARCT incluído (IMSLP 10+).
 */
export function tierOf(level: number): DifficultyTier {
  if (level <= 5) return 'BEGINNER';
  if (level <= 9) return 'INTERMEDIATE';
  return 'ADVANCED';
}

export interface WorkDifficultySummary {
  tier: DifficultyTier;
  /** O nível que vale para a obra, 1–15. */
  level: number;
  /** "Lvl 6", ou "Lvl 2–7" quando só trechos foram avaliados. */
  rating: string;
  /** A entrada que deu o nível. */
  entryId: number;
}

const median = (sorted: number[]) =>
  sorted[Math.floor((sorted.length - 1) / 2)];

/**
 * Teclados sem lista própria: a de piano vale para eles (os Minuetos do
 * Caderno de Anna Magdalena são peças de teclado, ensinadas ao piano).
 */
const KEYBOARD_ON_PIANO_LIST = new Set(['Teclado', 'Cravo', 'Clavicórdio']);

/**
 * O nível de uma obra a partir das suas entradas. **Só as listas dos
 * instrumentos da obra contam**: as Arabescas de Debussy estão na lista de harpa no nível
 * 12, e esse não é o nível de quem as toca ao piano. As avaliações dos outros
 * instrumentos ficam guardadas com o instrumento. A avaliação da obra inteira
 * vale antes dos trechos; só com trechos, vale o trecho do meio e a faixa
 * aparece no rótulo ("Lvl 3–9": o Álbum para a Juventude tem peças de vários
 * níveis).
 */
export function summarize(
  entries: DifficultyEntry[],
  workInstruments: string | null | Array<string | null>,
): WorkDifficultySummary | null {
  // A lista do principal primeiro; a sonata para violoncelo e piano avaliada
  // só na lista de piano ainda é uma avaliação de quem a toca.
  const pool =
    [workInstruments]
      .flat()
      .map((name) =>
        entries.filter(
          (e) =>
            e.instrument ===
            (KEYBOARD_ON_PIANO_LIST.has(name ?? '') ? 'Piano' : name),
        ),
      )
      .find((list) => list.length) ?? [];
  if (!pool.length) return null;
  const whole = pool.filter((e) => !e.excerpt);
  const basis = (whole.length ? whole : pool)
    .slice()
    .sort((a, b) => a.level - b.level || a.entryId - b.entryId);
  const level = median(basis.map((e) => e.level));
  const chosen = basis.find((e) => e.level === level)!;
  const min = basis[0].level;
  const max = basis[basis.length - 1].level;
  return {
    tier: tierOf(level),
    level,
    rating: !whole.length && min !== max ? `Lvl ${min}–${max}` : `Lvl ${level}`,
    entryId: chosen.entryId,
  };
}
