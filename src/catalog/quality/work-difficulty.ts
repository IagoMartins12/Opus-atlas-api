/**
 * Dificuldade das obras. A raspagem não trouxe nenhuma nota de fonte (IMSLP,
 * RCM, ABRSM): o que há no banco é um palpite, e errado nas obras famosas
 * (os Estudos Op. 10 de Chopin como "iniciante"). Aqui ficam as duas
 * correções que se sustentam sem fonte: o estudo de virtuose é avançado, e
 * "iniciante" só fica onde o título diz que é para quem começa. Melhor vazio
 * que errado.
 */
export type DifficultyLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type DifficultyFix =
  | { action: 'raise'; to: 'ADVANCED'; reason: string }
  | { action: 'clear'; reason: string }
  | null;

/** Títulos que, em qualquer compositor, são obra de virtuose. */
const VIRTUOSO_TITLE = [
  /concert[- ]?[ée]tudes?/i,
  /transcendental/i,
  /[ée]tudes?[- ]tableaux/i,
  /grandes? [ée]tudes?/i,
  /islamey/i,
  /gaspard de la nuit/i,
  /paganini.*(caprice|variations|[ée]tude)/i,
];

/** Compositores cujos "estudos" são concerto, não exercício de escola. */
const ETUDE_VIRTUOSOS = [
  'chopin',
  'liszt',
  'rachmaninoff',
  'rachmaninov',
  'scriabin',
  'debussy',
  'ligeti',
  'alkan',
  'godowsky',
  'paganini',
  'kapustin',
  'szymanowski',
  'medtner',
];

const ETUDE = /[ée]tudes?|studies|study\b/i;

/** O título diz que a obra é para quem começa. */
const BEGINNER_TITLE =
  /\b(easy|easiest|little|beginners?|first|children|childhood|kinder|young|album for|notebook|anna magdalena|leichte?|facile|petit|primer|elementary|simple|instructive|school|lessons?|exercises?)\b/i;

export function difficultyFix(work: {
  title: string;
  composerName: string;
  level: string | null;
}): DifficultyFix {
  if (work.level === 'ADVANCED' || !work.level) return null;
  const composer = work.composerName.toLowerCase();

  if (
    VIRTUOSO_TITLE.some((r) => r.test(work.title)) ||
    (composer.includes('beethoven') &&
      /hammerklavier|op\.? ?106\b/i.test(work.title)) ||
    (composer.includes('paganini') && /caprices?/i.test(work.title)) ||
    (ETUDE.test(work.title) &&
      ETUDE_VIRTUOSOS.some((n) => composer.includes(n)))
  )
    return { action: 'raise', to: 'ADVANCED', reason: 'estudo de virtuose' };

  if (work.level === 'BEGINNER' && !BEGINNER_TITLE.test(work.title))
    return { action: 'clear', reason: 'iniciante sem sinal no título' };

  return null;
}
