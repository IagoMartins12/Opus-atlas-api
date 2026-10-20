/**
 * Instrumento principal das obras já gravadas, corrigido a partir do que
 * está guardado (título em inglês, instrumentação em português).
 *
 * A raspagem procurava "bass" como trecho de texto — achava "bassoon", "bass
 * voice", "figured bass" — e gravou 5 mil obras como contrabaixo; e o catálogo
 * não tem o instrumento "Flauta", então as flautas ficaram em "Flauta Doce".
 * O erro está corrigido na raspagem (`determinePrimaryInstrument`); isto
 * conserta o que já entrou. Só mexe quando há evidência: sem ela, o instrumento
 * fica como está.
 */

const strip = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O título diz que a obra é, de fato, para contrabaixo. */
const DOUBLE_BASS_TITLE =
  /double.?bass|contrabass(?!oon)|kontrabass|string bass/i;

/** Nomes que não dizem qual é o instrumento da obra. */
const NOT_A_MAIN_INSTRUMENT = new Set([
  'Contrabaixo',
  'Baixo Contínuo',
  'Acompanhamento',
  'Ad Libitum',
  'Desconhecido',
  'Partes',
  'Solo',
]);

/**
 * Peças de uma orquestra ou de um conjunto: aparecem na lista dos instrumentos
 * de uma sinfonia, mas não dizem qual é a obra. Só contam quando nada melhor
 * foi achado.
 */
const SECTION_INSTRUMENTS = new Set([
  'Triângulo',
  'Tímpanos',
  'Caixa',
  'Pratos',
  'Sinos',
  'Gongo',
  'Flautim',
  'Cordas',
  'Metais',
  'Madeiras',
  'Percussão',
  'Carrilhão',
  'Celesta',
  'Bateria',
  'Xilofone',
  'Vibrafone',
  'Marimba',
  'Tabla',
]);

const ENSEMBLES = ['Orquestra de Cordas', 'Orquestra', 'Coro'];
const VOICES = ['Soprano', 'Contralto', 'Tenor', 'Barítono', 'Voz', 'Vocal'];

export type BassVerdict =
  | { action: 'keep' }
  | { action: 'move'; to: string }
  | { action: 'unknown' };

const mentions = (text: string, name: string) =>
  new RegExp(
    `(?<![a-z])${strip(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`,
  ).test(text);

const earliest = (text: string, candidates: string[]) => {
  let best: { at: number; name: string } | null = null;
  for (const name of candidates) {
    const at = text.search(
      new RegExp(
        `(?<![a-z])${strip(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`,
      ),
    );
    if (at < 0) continue;
    // O que aparece primeiro; no mesmo ponto, o nome mais longo.
    if (
      !best ||
      at < best.at ||
      (at === best.at && name.length > best.name.length)
    )
      best = { at, name };
  }
  return best?.name ?? null;
};

/**
 * A obra gravada como contrabaixo é mesmo para contrabaixo? Se não, para qual
 * instrumento vai, na ordem de evidência:
 *
 *  1. o instrumento do **título** (`fromTitle`: "Bassoon Concerto" é fagote);
 *  2. "Orquestra" ou "Coro" na instrumentação — uma sinfonia é orquestra, ainda
 *     que cite flautim e tímpanos;
 *  3. as vozes (soprano, tenor…);
 *  4. o primeiro instrumento citado, ignorando os de seção de orquestra.
 *
 * Sem nada disso, `unknown`: o instrumento fica como está.
 */
export function classifyBassWork(
  work: { title: string; instrumentation: string | null },
  instrumentNames: string[],
  fromTitle: string | null,
): BassVerdict {
  if (DOUBLE_BASS_TITLE.test(work.title)) return { action: 'keep' };
  if (fromTitle === 'Contrabaixo') return { action: 'keep' };
  // "Flauta" ainda pode não existir no catálogo: o script a cria.
  if (fromTitle === 'Flauta') return { action: 'move', to: 'Flauta' };
  if (
    fromTitle &&
    !NOT_A_MAIN_INSTRUMENT.has(fromTitle) &&
    instrumentNames.includes(fromTitle)
  )
    return { action: 'move', to: fromTitle };

  const text = ` ${strip(work.instrumentation ?? '')} `;
  const usable = instrumentNames.filter((n) => !NOT_A_MAIN_INSTRUMENT.has(n));

  const ensemble = earliest(
    text,
    ENSEMBLES.filter((n) => usable.includes(n) && mentions(text, n)),
  );
  if (ensemble) return { action: 'move', to: ensemble };

  const voice = earliest(
    text,
    VOICES.filter((n) => usable.includes(n)),
  );
  if (voice) return { action: 'move', to: voice };

  const other = earliest(
    text,
    usable.filter((n) => !SECTION_INSTRUMENTS.has(n)),
  );
  return other ? { action: 'move', to: other } : { action: 'unknown' };
}

/**
 * A obra gravada como "Flauta Doce" é para flauta (transversal)? Sim quando o
 * título diz flute e nem ele nem a instrumentação falam em recorder / flauta
 * doce.
 */
export function isFluteNotRecorder(work: {
  title: string;
  instrumentation: string | null;
}): boolean {
  const title = strip(work.title);
  const instrumentation = strip(work.instrumentation ?? '');

  if (/recorder|flauta doce|blockfl/.test(`${title} ${instrumentation}`))
    return false;

  return (
    /(?<![a-z])flutes?(?![a-z])|querfl|flauta traversa/.test(title) ||
    /^\s*flauta(?![a-z])/.test(instrumentation)
  );
}
