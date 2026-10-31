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

/** Como a ficha chama cada instrumento (já sem acento e em minúsculas). */
const FICHA_NAMES: Record<string, string> = {
  piano: 'Piano',
  teclado: 'Teclado',
  keyboard: 'Teclado',
  orgao: 'Órgão',
  harmonio: 'Harmônio',
  cravo: 'Cravo',
  clavicordio: 'Clavicórdio',
  harpa: 'Harpa',
  violao: 'Violão',
  guitars: 'Violão',
  alaude: 'Alaúde',
  bandolim: 'Bandolim',
  violino: 'Violino',
  violins: 'Violino',
  viola: 'Viola',
  violas: 'Viola',
  violoncelo: 'Violoncelo',
  cellos: 'Violoncelo',
  contrabaixo: 'Contrabaixo',
  flauta: 'Flauta',
  flutes: 'Flauta',
  'flauta doce': 'Flauta Doce',
  recorders: 'Flauta Doce',
  flautim: 'Flautim',
  oboe: 'Oboé',
  oboes: 'Oboé',
  'corne ingles': 'Corne Inglês',
  clarinete: 'Clarinete',
  clarinets: 'Clarinete',
  fagote: 'Fagote',
  bassoons: 'Fagote',
  saxofone: 'Saxofone',
  trompa: 'Trompa',
  horns: 'Trompa',
  trompete: 'Trompete',
  trumpets: 'Trompete',
  corneta: 'Corneta',
  trombone: 'Trombone',
  trombones: 'Trombone',
  tuba: 'Tuba',
  acordeao: 'Acordeão',
  voz: 'Voz',
  vozes: 'Voz',
  soprano: 'Soprano',
  contralto: 'Contralto',
  tenor: 'Tenor',
  baritono: 'Barítono',
  orquestra: 'Orquestra',
  'orquestra de cordas': 'Orquestra de Cordas',
  cordas: 'Cordas',
  coro: 'Coro',
};

/** O que acompanha na ficha "solista, acompanhamento". */
const ACCOMPANIMENT = new Set([
  'piano',
  'teclado',
  'orgao',
  'cravo',
  'violao',
  'orquestra',
  'orquestra de cordas',
  'cordas',
  'baixo continuo',
]);

/** Um pedaço da ficha sem o que não diz o instrumento ("2 Violins", "Piano Solo"). */
const segmentOf = (text: string) =>
  text
    .replace(/\(.*?\)/g, ' ')
    .replace(
      /\b(solo|satb|ssa|ttbb|4-maos|hands|original|revised|mixed|male|female)\b/g,
      ' ',
    )
    .replace(/^\s*\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** O instrumento principal de uma combinação da ficha, ou nada. */
function fromCombination(combination: string): string | null {
  const parts = combination.split(',').map(segmentOf).filter(Boolean);
  if (!parts.length) return null;
  if (parts.includes('coro'))
    return parts.includes('orquestra') ? null : 'Coro';
  if (parts.length > 2) return null;
  if (parts.length === 1) return FICHA_NAMES[parts[0]] ?? null;
  return ACCOMPANIMENT.has(parts[1]) ? (FICHA_NAMES[parts[0]] ?? null) : null;
}

/**
 * Os instrumentos que a ficha do IMSLP dá à obra, o principal primeiro. A
 * ficha é a evidência mais forte que o acervo tem: quem escolheu o instrumento
 * pelo título e pelas categorias gravou órgão, violão e vozes como piano (o
 * padrão), cravo como harpa ("harpsichord"), trompete como trompa ("hornpipe")
 * e a Tocata BWV 565 como quarteto (um arranjo para quatro).
 *
 * Cada alternativa conta (`;` separa versões, "ou" separa escolhas). Vale:
 * um instrumento só; solista com acompanhamento ("Voz, Piano" é voz); coro sem
 * orquestra. Combinação maior (trio, ópera) não decide: lista vazia.
 */
export function instrumentsFromFicha(
  instrumentation: string | null | undefined,
): string[] {
  if (!instrumentation?.trim()) return [];
  const found = strip(instrumentation)
    .split(/;|\sou\s/)
    .map(fromCombination)
    .filter((name): name is string => !!name);
  return [...new Set(found)];
}

/**
 * Para onde a obra vai segundo a ficha: o primeiro instrumento dela, a menos
 * que o atual já seja um dos que a ficha aceita. "Contrabaixo" só com o título
 * confirmando: na ficha, "Bass" tanto é o instrumento quanto a voz de baixo
 * ("12 Sacred Songs for Bass").
 */
export function instrumentMove(
  work: { title: string; instrumentation: string | null | undefined },
  current: string,
): string | null {
  const found = instrumentsFromFicha(work.instrumentation);
  if (!found.length || found.includes(current)) return null;
  if (found[0] === 'Contrabaixo' && !DOUBLE_BASS_TITLE.test(work.title))
    return null;
  return found[0];
}

/**
 * Todos os instrumentos da obra, o principal primeiro: uma canção é de voz e
 * também de piano, e a obra aparece nos dois. Aqui toda parte citada conta,
 * inclusive em combinação que não decide o principal (trio, ópera); de quem
 * só acompanha, o baixo contínuo fica de fora, porque não é instrumento.
 */
export function workInstruments(
  work: { title: string; instrumentation: string | null | undefined },
  main: string | null,
): string[] {
  const named = strip(work.instrumentation ?? '')
    .split(/;|,|\sou\s/)
    .map(segmentOf)
    .map((part) => FICHA_NAMES[part])
    .filter((name): name is string => !!name)
    .filter(
      (name) => name !== 'Contrabaixo' || DOUBLE_BASS_TITLE.test(work.title),
    );
  // "Teclado" na ficha é quem se toca ao piano também (Invenções de Bach).
  const keyboard = named.includes('Teclado') || main === 'Teclado';
  return [
    ...new Set([
      ...(main ? [main] : []),
      ...named,
      ...(keyboard ? ['Piano'] : []),
    ]),
  ];
}
