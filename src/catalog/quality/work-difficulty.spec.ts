import { difficultyFix } from './work-difficulty';

const w = (title: string, composerName: string, level: string | null) =>
  difficultyFix({ title, composerName, level });

describe('difficultyFix', () => {
  it('sobe os estudos de virtuose para avançado', () => {
    expect(w('12 Études, Op.10', 'Frédéric Chopin', 'BEGINNER')).toMatchObject({
      action: 'raise',
      to: 'ADVANCED',
    });
    expect(
      w('Études d’exécution transcendante', 'Franz Liszt', 'INTERMEDIATE'),
    ).toMatchObject({ action: 'raise' });
    expect(w('Islamey', 'Mily Balakirev', 'INTERMEDIATE')).toMatchObject({
      action: 'raise',
    });
  });

  it('não confunde Hammerklavier ou Caprices de outro compositor', () => {
    expect(w('Rondo für Hammerklavier', 'Heeren', 'INTERMEDIATE')).toBeNull();
    expect(w('12 Caprices, Op.1', 'Horneman', 'INTERMEDIATE')).toBeNull();
    expect(
      w('Sonata, Op.106', 'Ludwig van Beethoven', 'INTERMEDIATE'),
    ).toMatchObject({ action: 'raise' });
    expect(
      w('24 Caprices, Op.1', 'Niccolò Paganini', 'INTERMEDIATE'),
    ).toMatchObject({ action: 'raise' });
  });

  it('não sobe estudo de escola', () => {
    expect(w('50 Études, Op.740', 'Carl Czerny', 'INTERMEDIATE')).toBeNull();
    expect(w('Studies, Op.50', 'Johann Baptist Cramer', 'BEGINNER')).toEqual({
      action: 'clear',
      reason: 'iniciante sem sinal no título',
    });
  });

  it('esvazia iniciante sem sinal no título e mantém o que diz ser fácil', () => {
    expect(w('10 Bagatelles, Op.5', 'Anon', 'BEGINNER')).toMatchObject({
      action: 'clear',
    });
    expect(
      w('Album for the Young, Op.68', 'Robert Schumann', 'BEGINNER'),
    ).toBeNull();
    expect(w('Little Preludes', 'J. S. Bach', 'BEGINNER')).toBeNull();
  });

  it('não mexe no que já é avançado nem no que não tem nota', () => {
    expect(w('Op.10', 'Chopin', 'ADVANCED')).toBeNull();
    expect(w('Op.10', 'Chopin', null)).toBeNull();
    expect(w('Sonata, Op.1', 'Anon', 'INTERMEDIATE')).toBeNull();
  });
});
