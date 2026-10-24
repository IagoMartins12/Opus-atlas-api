/**
 * O motor de recomendação de peças (Plus): dado um conjunto de obras de
 * partida (a obra aberta, ou o que a pessoa estuda e quer estudar), pontua as
 * candidatas e diz **por quê**.
 *
 * Os sinais e os pesos, do mais forte ao mais fraco:
 *
 * - **Quem estudou isto também estudou** (listas e favoritos de outras
 *   pessoas): o sinal mais forte quando existe — cresce sozinho com o uso.
 * - **Mesmo instrumento**: recomendação de estudo que muda de instrumento não
 *   serve a quem estuda; a instrumentação idêntica ("Piano 4 mãos") soma mais.
 * - **Mesmo compositor** e **mesmo gênero** (noturno, sonata, valsa…).
 * - **Mesma época**.
 * - **Dificuldade**: peso baixo de propósito — no acervo ela é quase sempre um
 *   palpite sem fonte. Um passo acima é o melhor; muito acima, pior.
 * - **Popularidade** e **ter partitura para baixar**: desempate.
 *
 * Depois, diversidade: no máximo três obras do mesmo compositor na lista.
 * Função pura: o serviço busca as candidatas e chama `rank`.
 */

export type Reason =
  | 'co-study'
  | 'same-instrument'
  | 'same-instrumentation'
  | 'same-composer'
  | 'same-genre'
  | 'same-epoch'
  | 'step-up'
  | 'same-level'
  | 'popular';

export interface WorkFeatures {
  id: string;
  composerId: string;
  instrumentId: string;
  epochId: string;
  instrumentation: string | null;
  genres: string[];
  difficultyLevel: string | null;
}

export interface Seed extends WorkFeatures {
  /** Quanto esta obra pesa no gosto da pessoa (0 a 2). */
  weight: number;
}

export interface Candidate extends WorkFeatures {
  /** Pessoas que têm a obra de partida e esta nas listas ou favoritos. */
  coStudy: number;
  /** Favoritos + quero aprender + já aprendi, de todo mundo. */
  popularity: number;
  hasScore: boolean;
  /**
   * Quanto o compositor é conhecido (0 a 1): favoritos dele, biografia e
   * retrato. Sem isso, o acervo do IMSLP (cheio de compositores obscuros)
   * enchia a lista de nomes que ninguém procura.
   */
  prominence?: number;
}

export interface Ranked {
  id: string;
  score: number;
  reasons: Reason[];
}

const WEIGHTS = {
  coStudy: 3,
  instrument: 2.5,
  instrumentation: 1,
  composer: 2,
  genre: 1.5,
  epoch: 1,
  stepUp: 0.6,
  sameLevel: 0.3,
  tooHard: -0.4,
  popularity: 0.6,
  hasScore: 0.7,
  noScore: -1,
  prominence: 1.2,
};

/** Gêneros que não dizem nada sobre a peça. */
const GENERIC_GENRES = new Set(['não definido', 'pieces', 'peças', 'obras']);

const LEVEL = { BEGINNER: 0, INTERMEDIATE: 1, ADVANCED: 2 } as const;
const levelOf = (l: string | null): number | null =>
  l && l in LEVEL ? LEVEL[l as keyof typeof LEVEL] : null;

const norm = (s: string | null) => (s ?? '').trim().toLowerCase();

export function rank(
  seeds: Seed[],
  candidates: Candidate[],
  options: { limit: number; maxPerComposer?: number; exclude?: Set<string> },
): Ranked[] {
  if (!seeds.length) return [];
  const totalWeight = seeds.reduce((n, s) => n + s.weight, 0) || 1;
  const seedIds = new Set(seeds.map((s) => s.id));
  const share = (pick: (s: Seed) => boolean) =>
    seeds.filter(pick).reduce((n, s) => n + s.weight, 0) / totalWeight;

  const scored: Ranked[] = [];
  for (const c of candidates) {
    if (seedIds.has(c.id) || options.exclude?.has(c.id)) continue;
    const parts: Array<[Reason | null, number]> = [];

    if (c.coStudy > 0)
      parts.push([
        'co-study',
        WEIGHTS.coStudy * Math.min(1, Math.log2(1 + c.coStudy) / 3),
      ]);

    const instrument = share((s) => s.instrumentId === c.instrumentId);
    if (instrument > 0)
      parts.push(['same-instrument', WEIGHTS.instrument * instrument]);
    const instrumentation = share(
      (s) =>
        !!c.instrumentation &&
        norm(s.instrumentation) === norm(c.instrumentation),
    );
    if (instrumentation > 0)
      parts.push([
        'same-instrumentation',
        WEIGHTS.instrumentation * instrumentation,
      ]);

    const composer = share((s) => s.composerId === c.composerId);
    if (composer > 0)
      parts.push(['same-composer', WEIGHTS.composer * composer]);

    const genres = c.genres
      .map(norm)
      .filter((g) => g && !GENERIC_GENRES.has(g));
    const genre = share((s) =>
      s.genres.map(norm).some((g) => genres.includes(g)),
    );
    if (genre > 0) parts.push(['same-genre', WEIGHTS.genre * genre]);

    const epoch = share((s) => s.epochId === c.epochId);
    if (epoch > 0) parts.push(['same-epoch', WEIGHTS.epoch * epoch]);

    // Dificuldade: comparada com o nível mais alto entre as obras de partida.
    const seedLevels = seeds
      .map((s) => levelOf(s.difficultyLevel))
      .filter((l): l is number => l !== null);
    const mine = levelOf(c.difficultyLevel);
    if (seedLevels.length && mine !== null) {
      const top = Math.max(...seedLevels);
      if (mine === top + 1) parts.push(['step-up', WEIGHTS.stepUp]);
      else if (mine === top) parts.push(['same-level', WEIGHTS.sameLevel]);
      else if (mine > top + 1) parts.push([null, WEIGHTS.tooHard]);
    }

    if (c.popularity > 0)
      parts.push([
        'popular',
        WEIGHTS.popularity * Math.min(1, Math.log10(1 + c.popularity) / 2),
      ]);
    parts.push([null, c.hasScore ? WEIGHTS.hasScore : WEIGHTS.noScore]);
    if (c.prominence) parts.push([null, WEIGHTS.prominence * c.prominence]);

    const score = parts.reduce((n, [, v]) => n + v, 0);
    const reasons = parts
      .filter(([r, v]) => r && v > 0.2)
      .sort((a, b) => b[1] - a[1])
      .map(([r]) => r as Reason)
      .slice(0, 3);
    scored.push({ id: c.id, score: Math.round(score * 1000) / 1000, reasons });
  }

  scored.sort((a, b) => b.score - a.score);

  // Diversidade: no máximo `maxPerComposer` obras do mesmo compositor.
  const max = options.maxPerComposer ?? 3;
  const byComposer = new Map(candidates.map((c) => [c.id, c.composerId]));
  const perComposer = new Map<string, number>();
  const out: Ranked[] = [];
  for (const r of scored) {
    const composer = byComposer.get(r.id) ?? '';
    const n = perComposer.get(composer) ?? 0;
    if (n >= max) continue;
    perComposer.set(composer, n + 1);
    out.push(r);
    if (out.length >= options.limit) break;
  }
  return out;
}
