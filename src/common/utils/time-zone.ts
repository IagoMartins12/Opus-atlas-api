/**
 * Conversão entre instante e data/hora local num fuso IANA.
 *
 * Sem biblioteca de datas: o `Intl` do Node já conhece os fusos, e o que se
 * precisa é pouco — a data local de um instante, e o instante de uma data e
 * hora locais. Usado pelo calendário do blog (casas de espetáculo em quatro
 * fusos) e pela disponibilidade do professor (declarada no fuso dele).
 */

/** O fuso é conhecido pelo `Intl`? */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function offsetMinutes(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis));

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return Math.round((asUtc - utcMillis) / 60_000);
}

/** A data local (`YYYY-MM-DD`) de um instante, num fuso. */
export function localDate(instant: Date, timeZone: string): string {
  const shifted = new Date(
    instant.getTime() + offsetMinutes(instant.getTime(), timeZone) * 60_000,
  );

  return shifted.toISOString().slice(0, 10);
}

/** O instante de uma data e hora locais, num fuso. */
export function zonedDate(ymd: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  const [hours, minutes] = hhmm.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  const first = offsetMinutes(guess, timeZone);
  const second = offsetMinutes(guess - first * 60_000, timeZone);

  return new Date(guess - second * 60_000);
}
