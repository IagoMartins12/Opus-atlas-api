import {
  demonymOf,
  pickCountryId,
  yearOfWikidataTime,
  type WikidataClaim,
} from './nationality';

const claim = (
  id: string,
  rank: WikidataClaim['rank'] = 'normal',
  ended = false,
): WikidataClaim => ({
  rank,
  mainsnak: { datavalue: { value: { id } } },
  qualifiers: ended ? { P582: [] } : undefined,
});

describe('nationality', () => {
  it('transforma país, inclusive Estado histórico, em gentílico', () => {
    expect(demonymOf('Brazil')).toBe('Brazilian');
    expect(demonymOf('Kingdom of Prussia')).toBe('German');
    expect(demonymOf('Atlantis')).toBeNull();
  });

  it('escolhe a cidadania aberta e preferida', () => {
    expect(pickCountryId([claim('Q1'), claim('Q2', 'deprecated')])).toEqual([
      'Q1',
    ]);
    expect(pickCountryId([claim('Q1', 'normal', true), claim('Q2')])).toEqual([
      'Q2',
    ]);
    expect(pickCountryId([claim('Q1'), claim('Q2', 'preferred')])).toEqual([
      'Q2',
    ]);
    expect(pickCountryId([claim('Q1'), claim('Q2')])).toEqual(['Q1', 'Q2']);
    expect(pickCountryId(undefined)).toEqual([]);
  });

  it('lê o ano de uma data do Wikidata', () => {
    expect(yearOfWikidataTime('+1770-12-17T00:00:00Z')).toBe(1770);
    expect(yearOfWikidataTime(undefined)).toBeNull();
  });
});
