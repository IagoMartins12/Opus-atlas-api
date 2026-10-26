import {
  buildCards,
  eligible,
  personaOf,
  RetroStats,
  topPercent,
} from './retrospective-cards';

const stats = (over: Partial<RetroStats> = {}): RetroStats => ({
  firstName: 'Ana',
  period: 'year',
  year: 2026,
  learned: 6,
  want: 4,
  favoriteWorks: 3,
  favoriteComposers: 2,
  composers: 5,
  topComposer: { name: 'Chopin', count: 4, topPercent: 3 },
  topGenre: { name: 'noturnos', count: 3, topPercent: 10 },
  topEpoch: { name: 'Romântico', count: 7, share: 0.7 },
  topInstrument: { name: 'Piano', count: 9, share: 0.9 },
  masteryAvg: 72,
  bestWork: { title: 'Nocturne Op.9 No.2', composer: 'Chopin', mastery: 95 },
  busiestMonth: { month: 2, count: 4 },
  practice: { minutes: 600, days: 12 },
  achievements: { count: 3, rarest: 'Maratonista' },
  community: { annotations: 2, contributions: 1 },
  next: ['Ballade No.1', 'Valsa Op.64', 'Estudo Op.10 No.3'].map((t, i) => ({
    label: `${t} — Chopin`,
    href: `/works/w${i}`,
    composer: { name: 'Chopin', url: null },
  })),
  ...over,
});

describe('retrospectiva', () => {
  it('monta a persona pelo instrumento e pela época', () => {
    expect(personaOf(stats(), 'pt')).toBe('Pianista romântico');
    expect(personaOf(stats(), 'en')).toBe('Romantic pianist');
    expect(
      personaOf(stats({ topInstrument: null, topEpoch: null }), 'pt'),
    ).toBe('Curiosidade sem fronteiras');
  });

  it('frases de destaque saem dos números', () => {
    const cards = buildCards(stats(), 'pt');
    const t = (k: string) => cards.find((c) => c.kind === k)?.title;
    expect(t('composer')).toBe('Entre os 3% maiores fãs de Chopin');
    expect(t('genre')).toBe('Está entre os top 10% fãs de noturnos');
    expect(t('epoch')).toBe('Expert no período Romântico');
    expect(t('month')).toBe('Em março você não parou');
    expect(cards[0].eyebrow).toBe('Seu 2026 na música');
    expect(cards[cards.length - 1].list).toHaveLength(3);
  });

  it('cada cartão desenha o seu: retrato, instrumento, época, mês e as próximas com link', () => {
    const cards = buildCards(
      stats({
        topComposer: {
          name: 'Chopin',
          count: 4,
          topPercent: 3,
          portraitUrl: 'https://x/chopin.jpg',
        },
        epochFaces: [{ name: 'Liszt', url: null }],
      }),
      'pt',
    );
    const art = (k: string) => cards.find((c) => c.kind === k)?.art;
    expect(art('composer')?.portrait).toEqual({
      name: 'Chopin',
      url: 'https://x/chopin.jpg',
    });
    expect(art('persona')?.instrument).toBe('Piano');
    expect(art('epoch')).toEqual({
      epoch: 'Romântico',
      faces: [{ name: 'Liszt', url: null }],
    });
    expect(art('month')?.month).toBe(2);
    const next = cards[cards.length - 1];
    expect(next.links).toEqual(['/works/w0', '/works/w1', '/works/w2']);
    expect(next.list?.[0]).toBe('Ballade No.1 — Chopin');
  });

  it('o primeiro lugar vira "maior fã"; sem base para comparar, sem ranking', () => {
    const top = buildCards(
      stats({ topComposer: { name: 'Bach', count: 9, topPercent: 1 } }),
      'pt',
    );
    expect(top.find((c) => c.kind === 'composer')?.title).toBe(
      'Maior fã de Bach',
    );
    const sem = buildCards(
      stats({ topComposer: { name: 'Bach', count: 2, topPercent: null } }),
      'pt',
    );
    expect(sem.find((c) => c.kind === 'composer')?.title).toBe(
      'Bach foi o seu compositor',
    );
  });

  it('época sem maioria não vira "expert"', () => {
    const c = buildCards(
      stats({ topEpoch: { name: 'Barroco', count: 2, share: 0.3 } }),
      'pt',
    );
    expect(c.find((x) => x.kind === 'epoch')?.title).toBe(
      'Sua época favorita: Barroco',
    );
  });

  it('cartão sem dado não aparece', () => {
    const c = buildCards(
      stats({
        practice: null,
        achievements: { count: 0, rarest: null },
        community: { annotations: 0, contributions: 0 },
      }),
      'pt',
    );
    expect(c.map((x) => x.kind)).not.toEqual(
      expect.arrayContaining(['practice']),
    );
    expect(c.map((x) => x.kind)).not.toContain('achievements');
    expect(c.map((x) => x.kind)).not.toContain('community');
  });

  it('em inglês', () => {
    const c = buildCards(stats(), 'en');
    expect(c[0].eyebrow).toBe('Your 2026 in music');
    expect(c.find((x) => x.kind === 'epoch')?.title).toBe(
      'Romantic period expert',
    );
  });

  it('top X% só com base suficiente', () => {
    expect(topPercent(5, [5, 1, 2, 3])).toBeNull();
    expect(topPercent(9, [9, 1, 2, 3, 4, 5, 6, 7, 8, 1])).toBe(10);
    expect(topPercent(1, [9, 8, 7, 6, 1])).toBe(100);
  });

  it('libera com 5 obras nas listas ou 3 aprendidas', () => {
    expect(eligible(4, 0)).toBe(false);
    expect(eligible(2, 3)).toBe(true);
    expect(eligible(0, 3)).toBe(true);
    expect(eligible(5, 0)).toBe(true);
  });
});
