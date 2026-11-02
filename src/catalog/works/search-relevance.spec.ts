import {
  accentPattern,
  composerCoverage,
  phrasePattern,
  relevanceStages,
  searchTokens,
  significantTokens,
} from './search-relevance';

const regex = (pattern: string) => new RegExp(pattern, 'i');

describe('palavras do termo', () => {
  it('sem acento, minúsculas, sem pontuação', () => {
    expect(searchTokens('  Für Élise, Op.27 ')).toEqual([
      'fur',
      'elise',
      'op',
      '27',
    ]);
  });

  it('as que distinguem; termo só de artigos fica inteiro', () => {
    expect(significantTokens(['sonata', 'ao', 'luar'])).toEqual([
      'sonata',
      'luar',
    ]);
    expect(significantTokens(['a', 'la'])).toEqual(['a', 'la']);
  });
});

describe('expressões', () => {
  it('a palavra sem acento acha a com acento, em qualquer caixa', () => {
    const fur = regex(accentPattern('fur'));
    expect(fur.test('Für Elise')).toBe(true);
    expect(regex(accentPattern('estacoes')).test('As Quatro Estações')).toBe(
      true,
    );
  });

  it('a frase aceita pontuação entre as palavras', () => {
    const op = regex(phrasePattern(['op', '27']));
    expect(op.test('Piano Sonata No.14, Op.27 No.2')).toBe(true);
    expect(op.test('Op. 2, No.7')).toBe(false);
  });
});

describe('compositor', () => {
  const composers = [
    { id: 'chopin', name: 'Chopin', fullName: 'Frédéric Chopin' },
    { id: 'luar', name: 'Outro', fullName: null },
  ];

  it('conta só quem cobre alguma palavra do termo', () => {
    const coverage = composerCoverage('chopin nocturne', composers);
    expect(coverage.get('chopin')).toBe(1);
    expect(coverage.has('luar')).toBe(false);
  });

  it('pedaço do começo do nome vale ("beeth")', () => {
    expect(
      composerCoverage('beeth', [
        { id: 'b', name: 'Beethoven', fullName: null },
      ]).get('b'),
    ).toBe(1);
  });
});

describe('estágios', () => {
  const stages = (term: string) =>
    JSON.stringify(relevanceStages({ term, composerCoverage: new Map() }));

  it('o nome igual aceita o complemento depois da vírgula ou do parêntese', () => {
    const exact = (
      relevanceStages({ term: 'clair de lune', composerCoverage: new Map() })[1]
        .$addFields as {
        _exact: { $or: Array<{ $regexMatch: { regex: string } }> };
      }
    )._exact.$or[0].$regexMatch.regex;

    expect(regex(exact).test('Clair de Lune (3º movimento)')).toBe(true);
    expect(regex(exact).test('Für Elise, WoO 59')).toBe(false);
    expect(regex(exact).test('Clair de lune, Op.13')).toBe(true);
    expect(regex(exact).test('Variations on Clair de lune')).toBe(false);
  });

  it('termo vazio só repassa o textScore', () => {
    expect(stages('  ')).toBe(
      JSON.stringify([{ $addFields: { _score: { $ifNull: ['$_ts', 0] } } }]),
    );
  });
});
