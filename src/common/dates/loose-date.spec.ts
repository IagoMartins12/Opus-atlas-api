import { composerDateParts, parseLooseDate } from './loose-date';

describe('parseLooseDate', () => {
  it.each([
    ['31 de janeiro de 1797', 1797, 1, 31],
    ['1º de março de 1810', 1810, 3, 1],
    ['January 31, 1797', 1797, 1, 31],
    ['16 December 1770', 1770, 12, 16],
    ['1797-01-31', 1797, 1, 31],
    ['1797', 1797, null, null],
    ['c. 1450', 1450, null, null],
    ['1797?', 1797, null, null],
    ['5 dezembro 1791', 1791, 12, 5],
    ['01/03/1810', 1810, 3, 1],
    ['17/10/1849', 1849, 10, 17],
  ])('%s', (text, year, month, day) => {
    expect(parseLooseDate(text)).toEqual({ year, month, day });
  });

  it('ignores empty and nonsense input', () => {
    expect(parseLooseDate(null)).toEqual({
      year: null,
      month: null,
      day: null,
    });
    expect(parseLooseDate('desconhecido')).toEqual({
      year: null,
      month: null,
      day: null,
    });
    expect(parseLooseDate('9999').year).toBeNull();
  });
});

describe('composerDateParts', () => {
  it('only fills the side that was given', () => {
    expect(composerDateParts({ birthDate: '1 March 1810' })).toEqual({
      birthYear: 1810,
      birthMonth: 3,
      birthDay: 1,
    });
    expect(composerDateParts({ deathDate: null })).toEqual({
      deathYear: null,
      deathMonth: null,
      deathDay: null,
    });
  });
});
