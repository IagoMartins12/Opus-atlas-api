import { Candidate, rank, Seed } from './recommendation-engine';

const seed = (over: Partial<Seed> = {}): Seed => ({
  id: 'seed',
  composerId: 'chopin',
  instrumentId: 'piano',
  epochId: 'romantico',
  instrumentation: 'Piano',
  genres: ['noturnos'],
  difficultyLevel: 'INTERMEDIATE',
  weight: 1,
  ...over,
});
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  composerId: 'outro',
  instrumentId: 'violino',
  epochId: 'barroco',
  instrumentation: null,
  genres: [],
  difficultyLevel: null,
  coStudy: 0,
  popularity: 0,
  hasScore: true,
  ...over,
});

describe('motor de recomendação', () => {
  it('prefere mesmo compositor e instrumento, e diz por quê', () => {
    const r = rank(
      [seed()],
      [
        cand('longe'),
        cand('perto', {
          composerId: 'chopin',
          instrumentId: 'piano',
          epochId: 'romantico',
          genres: ['noturnos'],
        }),
      ],
      { limit: 5 },
    );
    expect(r[0].id).toBe('perto');
    expect(r[0].reasons).toEqual(
      expect.arrayContaining(['same-instrument', 'same-composer']),
    );
  });

  it('quem estudou isto também estudou pesa muito', () => {
    const r = rank(
      [seed()],
      [
        cand('mesma-epoca', { epochId: 'romantico', instrumentId: 'piano' }),
        cand('coestudo', { instrumentId: 'piano', coStudy: 12 }),
      ],
      { limit: 5 },
    );
    expect(r[0].id).toBe('coestudo');
    expect(r[0].reasons[0]).toBe('co-study');
  });

  it('um passo acima na dificuldade é bom; muito acima, pior', () => {
    const base = { instrumentId: 'piano', composerId: 'chopin' };
    const r = rank(
      [seed({ difficultyLevel: 'BEGINNER' })],
      [
        cand('passo', { ...base, difficultyLevel: 'INTERMEDIATE' }),
        cand('salto', { ...base, difficultyLevel: 'ADVANCED' }),
      ],
      { limit: 5 },
    );
    expect(r.map((x) => x.id)).toEqual(['passo', 'salto']);
    expect(r[0].reasons).toContain('step-up');
  });

  it('obra sem partitura perde para a que tem', () => {
    const r = rank(
      [seed()],
      [
        cand('sem', { instrumentId: 'piano', hasScore: false }),
        cand('com', { instrumentId: 'piano', hasScore: true }),
      ],
      { limit: 5 },
    );
    expect(r[0].id).toBe('com');
  });

  it('não recomenda a própria obra nem o que a pessoa já tem', () => {
    const r = rank([seed()], [cand('seed'), cand('ja-tenho'), cand('nova')], {
      limit: 5,
      exclude: new Set(['ja-tenho']),
    });
    expect(r.map((x) => x.id)).toEqual(['nova']);
  });

  it('no máximo três obras do mesmo compositor', () => {
    const muitas = Array.from({ length: 6 }, (_, i) =>
      cand(`c${i}`, { composerId: 'chopin', instrumentId: 'piano' }),
    );
    const r = rank(
      [seed()],
      [...muitas, cand('outro', { instrumentId: 'piano' })],
      {
        limit: 10,
      },
    );
    expect(r.filter((x) => x.id.startsWith('c'))).toHaveLength(3);
    expect(r.map((x) => x.id)).toContain('outro');
  });

  it('gênero genérico ("pieces") não conta como gênero em comum', () => {
    const r = rank(
      [seed({ genres: ['pieces'] })],
      [cand('x', { genres: ['pieces'] })],
      {
        limit: 5,
      },
    );
    expect(r[0].reasons).not.toContain('same-genre');
  });

  it('sem obras de partida, não há recomendação', () => {
    expect(rank([], [cand('x')], { limit: 5 })).toEqual([]);
  });
});
