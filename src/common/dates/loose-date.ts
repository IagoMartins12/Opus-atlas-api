/**
 * Parts of a historical date written as free text, the way composer records
 * store them: "31 de janeiro de 1797", "1º de março de 1810",
 * "January 31, 1797", "16 December 1770", "1797-01-31", "01/03/1810"
 * (day first, as the Brazilian forms write it), "c. 1450", "1797?".
 *
 * Only what the text states is returned: "c. 1450" gives the year alone.
 * Years outside 400–2100 are ignored (they are typos, not dates).
 */
export interface LooseDateParts {
  year: number | null;
  month: number | null;
  day: number | null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  january: 1,
  fev: 2,
  fevereiro: 2,
  feb: 2,
  february: 2,
  mar: 3,
  março: 3,
  marco: 3,
  march: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  april: 4,
  mai: 5,
  maio: 5,
  may: 5,
  jun: 6,
  junho: 6,
  june: 6,
  jul: 7,
  julho: 7,
  july: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  august: 8,
  set: 9,
  setembro: 9,
  sep: 9,
  sept: 9,
  september: 9,
  out: 10,
  outubro: 10,
  oct: 10,
  october: 10,
  nov: 11,
  novembro: 11,
  november: 11,
  dez: 12,
  dezembro: 12,
  dec: 12,
  december: 12,
};

const EMPTY: LooseDateParts = { year: null, month: null, day: null };

const validYear = (y: number) => (y >= 400 && y <= 2100 ? y : null);
const validDay = (d: number) => (d >= 1 && d <= 31 ? d : null);

export function parseLooseDate(
  text: string | null | undefined,
): LooseDateParts {
  if (!text) return EMPTY;
  const raw = text.trim().toLowerCase();
  if (!raw) return EMPTY;

  const iso = raw.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const month = Number(iso[2]);
    return {
      year: validYear(Number(iso[1])),
      month: month >= 1 && month <= 12 ? month : null,
      day: validDay(Number(iso[3])),
    };
  }

  const slashed = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{3,4})\b/);
  if (slashed) {
    const month = Number(slashed[2]);
    return {
      year: validYear(Number(slashed[3])),
      month: month >= 1 && month <= 12 ? month : null,
      day: validDay(Number(slashed[1])),
    };
  }

  const yearMatch = raw.match(/\b(\d{3,4})\b(?!\s*(?:º|°|st|nd|rd|th))/g);
  const year = yearMatch
    ? validYear(Number(yearMatch[yearMatch.length - 1]))
    : null;

  const words = raw.normalize('NFC').match(/\p{L}+/gu) ?? [];
  const monthWord = words.find((w) => MONTHS[w] !== undefined);
  const month = monthWord ? MONTHS[monthWord] : null;

  let day: number | null = null;
  if (month) {
    // The day is a 1–2 digit number that is not the year.
    const dayMatch = raw.match(/\b(\d{1,2})(?:º|°|st|nd|rd|th)?\b/);
    day = dayMatch ? validDay(Number(dayMatch[1])) : null;
  }

  return { year, month, day: month ? day : null };
}

/** The six numeric columns kept beside `birthDate` / `deathDate`. */
export function composerDateParts(dates: {
  birthDate?: string | null;
  deathDate?: string | null;
}) {
  const result: Record<string, number | null> = {};
  if (dates.birthDate !== undefined) {
    const b = parseLooseDate(dates.birthDate);
    Object.assign(result, {
      birthYear: b.year,
      birthMonth: b.month,
      birthDay: b.day,
    });
  }
  if (dates.deathDate !== undefined) {
    const d = parseLooseDate(dates.deathDate);
    Object.assign(result, {
      deathYear: d.year,
      deathMonth: d.month,
      deathDay: d.day,
    });
  }
  return result as {
    birthYear?: number | null;
    birthMonth?: number | null;
    birthDay?: number | null;
    deathYear?: number | null;
    deathMonth?: number | null;
    deathDay?: number | null;
  };
}
