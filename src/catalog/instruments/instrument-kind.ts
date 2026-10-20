/**
 * What an `Instrument` row really is. The catalog imported from the IMSLP
 * mixes instruments with ensembles ("Orquestra", "Quarteto", "Duo") and with
 * placeholders that are neither ("Desconhecido", "Partes"). The filters keep
 * them apart: instruments in "Instrumento", ensembles in "Formação", and the
 * placeholders out of both.
 *
 * A list of names, not a column: it holds in every database at once, with no
 * migration, and a new import lands as an instrument until named here.
 */
export type InstrumentKind = 'instrument' | 'ensemble' | 'none';

const ENSEMBLES = new Set([
  'Orquestra',
  'Orquestra de Cordas',
  'Coro',
  'A Cappella',
  'Banda',
  'Conjunto',
  'Cordas',
  'Metais',
  'Madeiras',
  'Solo',
  'Duo',
  'Trio',
  'Quarteto',
  'Quarteto de Cordas',
  'Quinteto',
  'Sexteto',
  'Septeto',
  'Octeto',
  'Noneto',
  'Deceto',
]);

const NOT_INSTRUMENTS = new Set([
  'Desconhecido',
  'Partes',
  'Ad Libitum',
  'Acompanhamento',
]);

export function instrumentKind(name: string): InstrumentKind {
  if (ENSEMBLES.has(name)) return 'ensemble';
  if (NOT_INSTRUMENTS.has(name)) return 'none';
  return 'instrument';
}
