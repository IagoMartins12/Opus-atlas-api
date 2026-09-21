import {
  composerCompleteness,
  DEFAULT_EPOCH,
  epochByBirthYear,
  formatWikidataDate,
  JULIAN_CALENDAR,
  resolveNationality,
  surnameOf,
} from './wikipedia-composer.parser';
import { findNationalityByText } from '../composers/nationality-vocabulary';

describe('formatWikidataDate', () => {
  const time = (t: string, precision: number, calendarmodel?: string) => ({
    time: t,
    precision,
    calendarmodel,
  });

  it('devolve dia, mês e ano quando a precisão é de dia', () => {
    expect(formatWikidataDate(time('+1887-03-05T00:00:00Z', 11))).toBe(
      '1887-03-05',
    );
  });

  // Inventar dia e mês para quem só tem ano conhecido é criar informação que a
  // fonte não deu. Medido: Hildegard de Bingen tem precisão de ano.
  it('precisão de ano devolve só o ano', () => {
    expect(formatWikidataDate(time('+1098-01-01T00:00:00Z', 9))).toBe('1098');
  });

  it('precisão de mês devolve ano e mês', () => {
    expect(formatWikidataDate(time('+1750-07-01T00:00:00Z', 10))).toBe(
      '1750-07',
    );
  });

  // A diferença de dez dias some se o calendário não for dito. Medido: o
  // nascimento de Bach no Wikidata é juliano, e o próprio artigo em inglês
  // escreve "31 March [O.S. 21 March] 1685".
  it('marca a data que vem no calendário juliano', () => {
    expect(
      formatWikidataDate(time('+1685-03-21T00:00:00Z', 11, JULIAN_CALENDAR)),
    ).toBe('1685-03-21 (juliano)');
  });

  it('precisão de década é grosseira demais para o catálogo', () => {
    expect(formatWikidataDate(time('+1090-01-01T00:00:00Z', 8))).toBeNull();
  });

  it('devolve nulo sem valor', () => {
    expect(formatWikidataDate(null)).toBeNull();
  });

  it('devolve nulo para formato que não reconhece', () => {
    expect(formatWikidataDate(time('ontem', 11))).toBeNull();
  });
});

describe('epochByBirthYear', () => {
  it.each([
    ['1000', 'Medieval'],
    ['1500', 'Renascentista'],
    ['1685-03-21', 'Barroco'],
    ['1770', 'Clássico'],
    ['1860', 'Romântico'],
    ['1920', 'Modernismo'],
    ['1980', 'Contemporâneo'],
  ])('%s cai em %s', (data, epoca) => {
    expect(epochByBirthYear(data)).toBe(epoca);
  });

  it('sem data de nascimento, a época padrão', () => {
    expect(epochByBirthYear(null)).toBe(DEFAULT_EPOCH);
  });

  it('data sem ano legível cai no padrão', () => {
    expect(epochByBirthYear('século XII')).toBe(DEFAULT_EPOCH);
  });

  // É um palpite pelo ano de nascimento, e às vezes erra de forma visível:
  // Villa-Lobos, nascido em 1887, está como "Modernismo" no catálogo e cai em
  // "Romântico" por esta regra. Quem confirma é gente, na verificação.
  it('a regra discorda do catálogo em quem atravessa a virada do século', () => {
    expect(epochByBirthYear('1887-03-05')).toBe('Romântico');
  });
});

describe('surnameOf', () => {
  it('devolve o último pedaço do nome', () => {
    expect(surnameOf('Johann Sebastian Bach')).toBe('Bach');
  });

  it('nome de um pedaço só volta inteiro', () => {
    expect(surnameOf('Palestrina')).toBe('Palestrina');
  });

  it('colapsa espaços repetidos', () => {
    expect(surnameOf('  Heitor   Villa-Lobos ')).toBe('Villa-Lobos');
  });
});

describe('composerCompleteness', () => {
  const cheia = {
    bio: 'x'.repeat(200),
    birthDate: '1685',
    deathDate: '1750',
    nationality: 'Alemão',
    portraitUrl: 'https://exemplo/imagem.jpg',
  };

  it('ficha inteira dá 100', () => {
    expect(composerCompleteness(cheia)).toBe(100);
  });

  it('ficha vazia dá 0', () => {
    expect(
      composerCompleteness({
        bio: null,
        birthDate: null,
        deathDate: null,
        nationality: null,
        portraitUrl: null,
      }),
    ).toBe(0);
  });

  // Uma linha de biografia não é biografia.
  it('biografia curta demais não conta', () => {
    expect(composerCompleteness({ ...cheia, bio: 'Compositor.' })).toBe(67);
  });
});

describe('resolveNationality', () => {
  it('prefere o rótulo do país, que é dado estruturado', () => {
    expect(resolveNationality('Brasil', 'texto francês qualquer')).toBe(
      'Brasileiro',
    );
  });

  it('cai para o resumo do artigo quando não há país', () => {
    expect(
      resolveNationality(null, 'foi um compositor alemão do barroco'),
    ).toBe('Alemão');
  });

  it('devolve nulo quando nenhum dos dois diz', () => {
    expect(resolveNationality(null, 'um compositor')).toBeNull();
  });
});

describe('findNationalityByText', () => {
  it('reconhece o termo em português', () => {
    expect(findNationalityByText('compositor austríaco')).toBe('Austríaco');
  });

  it('reconhece o nome do país em inglês', () => {
    expect(findNationalityByText('born in Germany')).toBe('Alemão');
  });

  it('texto vazio devolve nulo', () => {
    expect(findNationalityByText('')).toBeNull();
  });
});
