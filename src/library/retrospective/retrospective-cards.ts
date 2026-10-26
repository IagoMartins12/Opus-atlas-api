/**
 * A retrospectiva de estudo (Plus), como a do Spotify: cartões com o que a
 * pessoa estudou, o que mais gostou e como se compara com quem estuda o mesmo.
 *
 * Função pura: recebe os números já contados (`RetroStats`) e devolve os
 * cartões no idioma pedido. **Nada é inventado**: cada frase sai de um número,
 * e as comparações ("entre os 5% maiores fãs") só aparecem com base suficiente
 * para fazerem sentido.
 */

export type Lang = 'pt' | 'en';

/** A composer's face on a card: the portrait, or the initials when none. */
export interface Face {
  name: string;
  url: string | null;
}

/** A suggested work for "next chapter", with its page. */
export interface NextWork {
  label: string;
  href: string;
  composer: Face;
}

export interface RetroStats {
  firstName: string;
  period: 'year' | 'all';
  year: number;
  learned: number;
  want: number;
  favoriteWorks: number;
  favoriteComposers: number;
  composers: number;
  topComposer: {
    name: string;
    count: number;
    topPercent: number | null;
    portraitUrl?: string | null;
  } | null;
  topGenre: { name: string; count: number; topPercent: number | null } | null;
  topEpoch: { name: string; count: number; share: number } | null;
  topInstrument: { name: string; count: number; share: number } | null;
  masteryAvg: number | null;
  bestWork: {
    title: string;
    composer: string;
    mastery: number;
    portraitUrl?: string | null;
  } | null;
  /** The composers most on the lists, most first (up to 6). */
  faces?: Face[];
  /** The same, only from the top era (up to 3). */
  epochFaces?: Face[];
  busiestMonth: { month: number; count: number } | null;
  practice: { minutes: number; days: number } | null;
  achievements: { count: number; rarest: string | null };
  community: { annotations: number; contributions: number };
  next: NextWork[];
}

export type CardKind =
  | 'intro'
  | 'persona'
  | 'composer'
  | 'genre'
  | 'epoch'
  | 'learned'
  | 'best'
  | 'practice'
  | 'discovery'
  | 'month'
  | 'achievements'
  | 'community'
  | 'next';

/**
 * What each card draws besides its number, so no two plates look alike: a
 * portrait in the middle (the composer, the work most mastered), faces in
 * orbit (the repertoire, the era, the next works), the instrument, the era,
 * the month. Cards saved before this have none and draw only the number.
 */
export interface RetroArt {
  portrait?: Face;
  faces?: Face[];
  /** The top instrument's name, as in the catalog. */
  instrument?: string;
  /** The top era, by its catalog name (`Barroco`, `Romântico`...). */
  epoch?: string;
  /** 0 to 11. */
  month?: number;
}

export interface RetroCard {
  kind: CardKind;
  eyebrow: string;
  title: string;
  value: string | null;
  detail: string | null;
  list?: string[];
  /** The page of each item of `list`, in the same order. */
  links?: string[];
  art?: RetroArt;
}

/** A partir de quanto se mostra "entre os X%": menos que isso é pouca gente. */
export const MIN_BASE_FOR_RANK = 5;

const EPOCH_ADJ: Record<string, Record<Lang, string>> = {
  Medieval: { pt: 'medieval', en: 'Medieval' },
  Renascentista: { pt: 'renascentista', en: 'Renaissance' },
  Barroco: { pt: 'barroco', en: 'Baroque' },
  Clássico: { pt: 'clássico', en: 'Classical' },
  Romântico: { pt: 'romântico', en: 'Romantic' },
  Modernismo: { pt: 'modernista', en: 'Modernist' },
  Contemporâneo: { pt: 'contemporâneo', en: 'Contemporary' },
};
const EPOCH_EN: Record<string, string> = {
  Medieval: 'Medieval',
  Renascentista: 'Renaissance',
  Barroco: 'Baroque',
  Clássico: 'Classical',
  Romântico: 'Romantic',
  Modernismo: 'Modernist',
  Contemporâneo: 'Contemporary',
};
const PLAYER: Array<[RegExp, Record<Lang, string>]> = [
  [/piano|pianoforte/i, { pt: 'Pianista', en: 'pianist' }],
  [/violino|violin/i, { pt: 'Violinista', en: 'violinist' }],
  [/violoncelo|cello/i, { pt: 'Violoncelista', en: 'cellist' }],
  [/viola(?! da)/i, { pt: 'Violista', en: 'violist' }],
  [/contrabaixo|double bass/i, { pt: 'Contrabaixista', en: 'double bassist' }],
  [/flauta doce|recorder/i, { pt: 'Flautista', en: 'recorder player' }],
  [/flauta|flute/i, { pt: 'Flautista', en: 'flutist' }],
  [/viol[ãa]o|guitar/i, { pt: 'Violonista', en: 'guitarist' }],
  [/órg[ãa]o|orgao|organ/i, { pt: 'Organista', en: 'organist' }],
  [/cravo|harpsichord/i, { pt: 'Cravista', en: 'harpsichordist' }],
  [/clarinete|clarinet/i, { pt: 'Clarinetista', en: 'clarinetist' }],
  [/obo[ée]|oboe/i, { pt: 'Oboísta', en: 'oboist' }],
  [/fagote|bassoon/i, { pt: 'Fagotista', en: 'bassoonist' }],
  [/trompete|trumpet/i, { pt: 'Trompetista', en: 'trumpeter' }],
  [/trompa|horn/i, { pt: 'Trompista', en: 'horn player' }],
  [/harpa|harp/i, { pt: 'Harpista', en: 'harpist' }],
  [/canto|voz|voice|soprano|tenor/i, { pt: 'Cantor', en: 'singer' }],
];

const MONTHS: Record<Lang, string[]> = {
  pt: [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

const n = (v: number, lang: Lang) =>
  v.toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Pianista romântico" / "Romantic pianist". */
export function personaOf(s: RetroStats, lang: Lang): string {
  const player = s.topInstrument
    ? PLAYER.find(([re]) => re.test(s.topInstrument!.name))?.[1][lang]
    : undefined;
  const adj = s.topEpoch ? EPOCH_ADJ[s.topEpoch.name]?.[lang] : undefined;
  if (lang === 'pt') {
    if (player && adj) return `${player} ${adj}`;
    if (player) return `${player} de muitas épocas`;
    if (adj) return `Alma ${adj}`;
    return 'Curiosidade sem fronteiras';
  }
  if (player && adj) return cap(`${adj} ${player}`);
  if (player) return cap(`${player} of many eras`);
  if (adj) return `${adj} soul`;
  return 'Curious without borders';
}

export function buildCards(s: RetroStats, lang: Lang): RetroCard[] {
  const pt = lang === 'pt';
  const when =
    s.period === 'year'
      ? pt
        ? `em ${s.year}`
        : `in ${s.year}`
      : pt
        ? 'até aqui'
        : 'so far';
  const total = s.learned + s.want;
  const cards: RetroCard[] = [];

  cards.push({
    kind: 'intro',
    eyebrow:
      s.period === 'year'
        ? pt
          ? `Seu ${s.year} na música`
          : `Your ${s.year} in music`
        : pt
          ? 'Sua história na música'
          : 'Your story in music',
    title: pt
      ? `${s.firstName}, veja o que você estudou ${when}`
      : `${s.firstName}, here is what you studied ${when}`,
    value: n(total, lang),
    detail: pt
      ? `${total === 1 ? 'obra' : 'obras'} entre "quero estudar" e "já aprendi"`
      : `${total === 1 ? 'work' : 'works'} between "want to study" and "learned"`,
  });

  cards.push({
    kind: 'persona',
    eyebrow: pt ? 'Seu perfil' : 'Your profile',
    title: personaOf(s, lang),
    value: null,
    art: s.topInstrument ? { instrument: s.topInstrument.name } : undefined,
    detail:
      [
        s.topInstrument &&
          (pt
            ? `${Math.round(s.topInstrument.share * 100)}% das obras são para ${s.topInstrument.name.toLowerCase()}`
            : `${Math.round(s.topInstrument.share * 100)}% of your works are for ${s.topInstrument.name.toLowerCase()}`),
        s.topEpoch &&
          (pt
            ? `${Math.round(s.topEpoch.share * 100)}% são do período ${s.topEpoch.name}`
            : `${Math.round(s.topEpoch.share * 100)}% are from the ${EPOCH_EN[s.topEpoch.name] ?? s.topEpoch.name} period`),
      ]
        .filter(Boolean)
        .join(pt ? '; ' : '; ') || null,
  });

  if (s.topComposer) {
    const c = s.topComposer;
    const ranked = c.topPercent !== null && c.topPercent <= 25;
    cards.push({
      kind: 'composer',
      eyebrow: pt ? 'Seu compositor' : 'Your composer',
      title: ranked
        ? c.topPercent! <= 1
          ? pt
            ? `Maior fã de ${c.name}`
            : `${c.name}'s biggest fan`
          : pt
            ? `Entre os ${c.topPercent}% maiores fãs de ${c.name}`
            : `Among the top ${c.topPercent}% of ${c.name} fans`
        : pt
          ? `${c.name} foi o seu compositor`
          : `${c.name} was your composer`,
      value: n(c.count, lang),
      detail: pt
        ? `${c.count === 1 ? 'obra' : 'obras'} de ${c.name} nas suas listas`
        : `${c.count === 1 ? 'work' : 'works'} by ${c.name} on your lists`,
      art: { portrait: { name: c.name, url: c.portraitUrl ?? null } },
    });
  }

  if (s.topGenre) {
    const g = s.topGenre;
    const ranked = g.topPercent !== null && g.topPercent <= 25;
    cards.push({
      kind: 'genre',
      eyebrow: pt ? 'Seu gênero' : 'Your genre',
      title: ranked
        ? pt
          ? `Está entre os top ${g.topPercent}% fãs de ${g.name}`
          : `In the top ${g.topPercent}% of ${g.name} fans`
        : pt
          ? `Você gosta mesmo de ${g.name}`
          : `You really like ${g.name}`,
      value: n(g.count, lang),
      detail: pt
        ? `${g.count === 1 ? 'peça' : 'peças'} do gênero`
        : `${g.count === 1 ? 'piece' : 'pieces'} of the genre`,
    });
  }

  if (s.topEpoch) {
    const e = s.topEpoch;
    const expert = e.share >= 0.4 && e.count >= 3;
    const name = pt ? e.name : (EPOCH_EN[e.name] ?? e.name);
    cards.push({
      kind: 'epoch',
      eyebrow: pt ? 'Sua época' : 'Your era',
      title: expert
        ? pt
          ? `Expert no período ${name}`
          : `${name} period expert`
        : pt
          ? `Sua época favorita: ${name}`
          : `Favorite era: ${name}`,
      value: `${Math.round(e.share * 100)}%`,
      detail: pt
        ? `das suas obras são do período ${name}`
        : `of your works come from the ${name} period`,
      art: {
        epoch: e.name,
        ...(s.epochFaces?.length ? { faces: s.epochFaces.slice(0, 3) } : {}),
      },
    });
  }

  if (s.learned > 0) {
    cards.push({
      kind: 'learned',
      eyebrow: pt ? 'Já aprendi' : 'Learned',
      title: pt
        ? `${s.learned} ${s.learned === 1 ? 'obra aprendida' : 'obras aprendidas'} ${when}`
        : `${s.learned} ${s.learned === 1 ? 'work' : 'works'} learned ${when}`,
      value: n(s.learned, lang),
      detail:
        // Maestria baixa não é elogio: só aparece de 10% para cima.
        s.masteryAvg !== null && s.masteryAvg >= 10
          ? pt
            ? `maestria média de ${Math.round(s.masteryAvg)}%`
            : `average mastery of ${Math.round(s.masteryAvg)}%`
          : null,
    });
  }

  if (s.bestWork && s.bestWork.mastery >= 30) {
    cards.push({
      kind: 'best',
      eyebrow: pt ? 'A que você mais domina' : 'The one you master most',
      title: s.bestWork.title,
      value: `${s.bestWork.mastery}%`,
      detail: s.bestWork.composer,
      art: {
        portrait: {
          name: s.bestWork.composer,
          url: s.bestWork.portraitUrl ?? null,
        },
      },
    });
  }

  if (s.practice && s.practice.minutes > 0) {
    const h = Math.round(s.practice.minutes / 60);
    cards.push({
      kind: 'practice',
      eyebrow: pt ? 'Horas no instrumento' : 'Hours at the instrument',
      title: pt
        ? `${h > 0 ? `${h} ${h === 1 ? 'hora' : 'horas'}` : `${s.practice.minutes} minutos`} de prática registrada`
        : `${h > 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${s.practice.minutes} minutes`} of logged practice`,
      value: n(s.practice.minutes, lang),
      detail: pt
        ? `minutos em ${s.practice.days} ${s.practice.days === 1 ? 'dia' : 'dias'}`
        : `minutes over ${s.practice.days} ${s.practice.days === 1 ? 'day' : 'days'}`,
    });
  }

  if (s.composers > 1) {
    cards.push({
      kind: 'discovery',
      eyebrow: pt ? 'Repertório' : 'Repertoire',
      title: pt
        ? `${s.composers} compositores diferentes`
        : `${s.composers} different composers`,
      value: n(s.composers, lang),
      detail: s.favoriteComposers
        ? pt
          ? `e ${s.favoriteComposers} nos favoritos`
          : `and ${s.favoriteComposers} in your favorites`
        : null,
      art: s.faces?.length ? { faces: s.faces.slice(0, 6) } : undefined,
    });
  }

  if (s.busiestMonth && s.busiestMonth.count > 1) {
    const m = MONTHS[lang][s.busiestMonth.month];
    cards.push({
      kind: 'month',
      eyebrow: pt ? 'Seu mês' : 'Your month',
      title: pt ? `Em ${m} você não parou` : `In ${m} you did not stop`,
      value: n(s.busiestMonth.count, lang),
      detail: pt
        ? 'obras adicionadas ou aprendidas no mês'
        : 'works added or learned that month',
      art: { month: s.busiestMonth.month },
    });
  }

  if (s.achievements.count > 0) {
    cards.push({
      kind: 'achievements',
      eyebrow: pt ? 'Conquistas' : 'Achievements',
      title: pt
        ? `${s.achievements.count} ${s.achievements.count === 1 ? 'conquista desbloqueada' : 'conquistas desbloqueadas'}`
        : `${s.achievements.count} ${s.achievements.count === 1 ? 'achievement' : 'achievements'} unlocked`,
      value: n(s.achievements.count, lang),
      detail: s.achievements.rarest
        ? pt
          ? `a mais rara: ${s.achievements.rarest}`
          : `rarest: ${s.achievements.rarest}`
        : null,
    });
  }

  const helped = s.community.annotations + s.community.contributions;
  if (helped > 0) {
    cards.push({
      kind: 'community',
      eyebrow: pt ? 'Comunidade' : 'Community',
      title: pt
        ? 'Você ajudou quem estuda depois'
        : 'You helped the next person studying',
      value: n(helped, lang),
      detail: pt
        ? `${s.community.annotations} ${s.community.annotations === 1 ? 'anotação' : 'anotações'} e ${s.community.contributions} ${s.community.contributions === 1 ? 'contribuição' : 'contribuições'} ao acervo`
        : `${s.community.annotations} ${s.community.annotations === 1 ? 'note' : 'notes'} and ${s.community.contributions} ${s.community.contributions === 1 ? 'contribution' : 'contributions'} to the catalog`,
    });
  }

  cards.push({
    kind: 'next',
    eyebrow: pt ? 'Próximo capítulo' : 'Next chapter',
    title: pt ? 'Para estudar a seguir' : 'To study next',
    value: null,
    detail: s.next.length
      ? pt
        ? 'escolhidas a partir do que você estudou'
        : 'picked from what you studied'
      : pt
        ? 'continue estudando: a próxima retrospectiva fica ainda melhor'
        : 'keep studying: the next one gets even better',
    list: s.next.slice(0, 3).map((w) => w.label),
    links: s.next.slice(0, 3).map((w) => w.href),
    art: s.next.length
      ? { faces: s.next.slice(0, 3).map((w) => w.composer) }
      : undefined,
  });

  return cards;
}

/** Top X% de uma contagem entre todos que têm ao menos um item (inteiro, 1 a 100). */
export function topPercent(mine: number, everyone: number[]): number | null {
  if (everyone.length < MIN_BASE_FOR_RANK || mine <= 0) return null;
  const above = everyone.filter((c) => c > mine).length;
  return Math.max(1, Math.ceil(((above + 1) / everyone.length) * 100));
}

/** Pode gerar: ao menos 5 obras entre as listas, ou 3 já aprendidas. */
export const RETRO_MIN_TOTAL = 5;
export const RETRO_MIN_LEARNED = 3;
export const eligible = (want: number, learned: number) =>
  want + learned >= RETRO_MIN_TOTAL || learned >= RETRO_MIN_LEARNED;
