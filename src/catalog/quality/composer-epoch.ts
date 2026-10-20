/**
 * A época de um compositor, conferida contra as datas dele.
 *
 * A raspagem herdou a época das categorias do IMSLP ("Romantic"), que cobrem
 * quem nasceu em 1905 e escreveu "em estilo romântico". A regra do catálogo é
 * **a época pelas datas**: o ponto de referência é o ano em que a pessoa fez 30
 * (`nascimento + 30`), quando a obra costuma estar em curso.
 *
 * Quem atravessa períodos (Beethoven, Schubert) não é corrigido de uma vez:
 * cada época aceita uma folga nas duas pontas, e só a que cai **fora** dela é
 * tida como errada.
 */
export const EPOCHS = [
  'Medieval',
  'Renascentista',
  'Barroco',
  'Clássico',
  'Romântico',
  'Modernismo',
  'Contemporâneo',
] as const;
export type EpochName = (typeof EPOCHS)[number];

const ACTIVE_AT = 30;

/** A época pelas datas, sem folga. */
export function epochByBirthYear(birthYear: number): EpochName {
  const year = birthYear + ACTIVE_AT;
  if (year < 1400) return 'Medieval';
  if (year < 1600) return 'Renascentista';
  if (year < 1750) return 'Barroco';
  if (year < 1820) return 'Clássico';
  if (year < 1900) return 'Romântico';
  if (year < 1945) return 'Modernismo';
  return 'Contemporâneo';
}

/** Intervalo aceito (ano de referência) de cada época, com a folga nas pontas. */
const TOLERANCE: Record<EpochName, [number, number]> = {
  Medieval: [0, 1450],
  Renascentista: [1380, 1650],
  Barroco: [1570, 1780],
  Clássico: [1720, 1850],
  Romântico: [1790, 1930],
  Modernismo: [1860, 1975],
  Contemporâneo: [1900, 9999],
};

/** Anos fora disto são erro de leitura da data, não pessoa. */
const PLAUSIBLE: [number, number] = [300, new Date().getFullYear()];

/**
 * A época a que o compositor deve passar, ou `null` quando a atual serve (ou
 * quando não dá para saber: sem ano, ou ano implausível).
 */
export function correctedEpoch(
  currentEpoch: string | null,
  birthYear: number | null,
): EpochName | null {
  if (birthYear == null) return null;
  if (birthYear < PLAUSIBLE[0] || birthYear > PLAUSIBLE[1]) return null;

  const year = birthYear + ACTIVE_AT;
  const range = TOLERANCE[currentEpoch as EpochName];
  if (range && year >= range[0] && year <= range[1]) return null;

  const proposed = epochByBirthYear(birthYear);
  return proposed === currentEpoch ? null : proposed;
}
