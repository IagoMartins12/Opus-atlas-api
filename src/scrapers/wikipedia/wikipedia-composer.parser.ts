import { findNationalityByText } from '../composers/nationality-vocabulary';

export { DEFAULT_EPOCH, epochByBirthYear, surnameOf } from '../composers/epoch';

/**
 * Um valor de tempo do Wikidata.
 *
 * `precision` diz até onde a data é conhecida: 11 é dia, 10 é mês, 9 é ano,
 * 8 é década. `calendarmodel` distingue juliano de gregoriano.
 */
export interface WikidataTime {
  time: string;
  precision: number;
  calendarmodel?: string;
}

/** O item do Wikidata para o calendário juliano. */
export const JULIAN_CALENDAR = 'http://www.wikidata.org/entity/Q1985786';

const PRECISION_DAY = 11;
const PRECISION_MONTH = 10;
const PRECISION_YEAR = 9;

/**
 * Converte uma data do Wikidata no texto que o catálogo guarda.
 *
 * **A precisão é respeitada, não arredondada.** O Wikidata diz até onde a data
 * é conhecida, e inventar dia e mês para um compositor de quem só se sabe o ano
 * é criar informação que a fonte não deu. Precisão de ano devolve `"1685"`;
 * de dia, `"1685-03-21"`.
 *
 * **O calendário vem junto quando é juliano.** A data de nascimento de Bach no
 * Wikidata é 21 de março de 1685 **no calendário juliano** — 31 de março no
 * gregoriano. As duas circulam por aí, e a diferença de dez dias some se o
 * calendário não for dito. O legado lia a data da prosa do artigo e ficava com
 * o que estivesse escrito, sem saber qual dos dois era.
 */
export function formatWikidataDate(value: WikidataTime | null): string | null {
  if (!value?.time) {
    return null;
  }

  // O formato é "+1685-03-21T00:00:00Z"; anos antes de Cristo vêm com "-".
  const match = value.time.match(/^([+-])(\d{4,})-(\d{2})-(\d{2})T/);

  if (!match) {
    return null;
  }

  const [, sign, year, month, day] = match;
  const prefix = sign === '-' ? '-' : '';
  const julian = value.calendarmodel === JULIAN_CALENDAR ? ' (juliano)' : '';

  if (value.precision >= PRECISION_DAY) {
    return `${prefix}${year}-${month}-${day}${julian}`;
  }

  if (value.precision === PRECISION_MONTH) {
    return `${prefix}${year}-${month}${julian}`;
  }

  if (value.precision === PRECISION_YEAR) {
    return `${prefix}${year}`;
  }

  // Precisão de década ou pior: o século já não é o que o catálogo guarda.
  return null;
}

/** Campos que contam para a completude, e quanto cada um vale. */
const COMPLETENESS_WEIGHTS = {
  bio: 2,
  birthDate: 1,
  deathDate: 1,
  nationality: 1,
  portraitUrl: 1,
};

const MIN_BIO_LENGTH = 50;

/** 0 a 100 — quanto da ficha veio preenchido. Pesos herdados do legado. */
export function composerCompleteness(data: {
  bio: string | null;
  birthDate: string | null;
  deathDate: string | null;
  nationality: string | null;
  portraitUrl: string | null;
}): number {
  const total = Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0);

  let score = 0;

  if (data.bio && data.bio.length > MIN_BIO_LENGTH) {
    score += COMPLETENESS_WEIGHTS.bio;
  }
  if (data.birthDate) score += COMPLETENESS_WEIGHTS.birthDate;
  if (data.deathDate) score += COMPLETENESS_WEIGHTS.deathDate;
  if (data.nationality) score += COMPLETENESS_WEIGHTS.nationality;
  if (data.portraitUrl) score += COMPLETENESS_WEIGHTS.portraitUrl;

  return Math.round((score / total) * 100);
}

/**
 * A nacionalidade, procurada onde ela costuma estar.
 *
 * O rótulo do país no Wikidata é a melhor fonte — é um dado estruturado, não
 * uma frase. O resumo do artigo é a reserva, e é onde o legado procurava.
 */
export function resolveNationality(
  countryLabel: string | null,
  summary: string | null,
): string | null {
  return (
    (countryLabel && findNationalityByText(countryLabel)) ??
    (summary && findNationalityByText(summary)) ??
    null
  );
}
