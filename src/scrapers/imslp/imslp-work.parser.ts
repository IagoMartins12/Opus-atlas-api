import * as cheerio from 'cheerio';

import { EPOCH_STYLE_MAPPING, VALID_CATEGORIES } from './imslp-categories';
import {
  INSTRUMENT_MAPPING,
  MODE_TRANSLATIONS,
  NOTE_TRANSLATIONS,
  VALID_WORKGENRES,
  WORK_GENRE_TRANSLATIONS,
} from './imslp-vocabulary';

/**
 * O tipo do documento carregado.
 *
 * Derivado de `cheerio.load` em vez de importado por nome: o cheerio 1.x
 * renomeou o tipo entre versões, e derivar do retorno não quebra na próxima.
 */
export type CheerioDocument = ReturnType<typeof cheerio.load>;

/**
 * O parser de página de obra do IMSLP — **um só**.
 *
 * **No legado havia duas cópias, e elas já divergiam.** As mesmas nove funções
 * estavam copiadas em `uploads/work/scraper` e em
 * `uploads/composer/[id]/works/process-single`. Comparando função a função:
 *
 * | função | situação |
 * |---|---|
 * | `extractImslpWorkId` | idêntica |
 * | `extractWorkDetails` | idêntica |
 * | `determinePrimaryInstrument` | idêntica |
 * | `cleanImslpUrl` | **divergiu** (15 vs 10 linhas) |
 * | `cleanTitle` | **divergiu** |
 * | `extractSubtitle` | **divergiu** (29 vs 27) |
 * | `extractCategories` | **divergiu** (32 vs 25) |
 * | `extractWorkGenres` | **divergiu** (83 vs 61) |
 * | `determineWorkType` | **divergiu** (148 vs 115) |
 *
 * Seis de nove. Quer dizer: **a mesma página do IMSLP produzia uma obra
 * diferente conforme a rota por onde entrasse** — outro tipo de obra, outros
 * gêneros, outro subtítulo. E a divergência não aparece em teste nenhum, porque
 * cada cópia era testada, no máximo, contra si mesma.
 *
 * Onde as duas discordavam, ficou a versão **mais completa** (a de
 * `work/scraper`): `determineWorkType` volta a olhar o corpo da página quando
 * o título não decide, que é justamente o caso difícil.
 */

export type ImslpWorkType =
  | 'INDIVIDUAL'
  | 'COMPLETE_WORK'
  | 'ARRANGEMENT'
  | 'COLLECTION'
  | 'COLLABORATION'
  | 'COMPOSITION'
  | 'COLLECTED_WORKS'
  | 'COLLECTIONS_WITH';

/** Palavras que classificam a obra, na ordem em que são testadas. */
const WORK_TYPE_KEYWORDS = {
  COLLABORATION: [
    'feat.',
    'featuring',
    'collaboration',
    'collaborative',
    'joint',
    'together',
    'co-composed',
  ],
  COLLECTED_WORKS: [
    'complete works',
    'complete pieces',
    'complete',
    'collected works',
    'collected pieces',
    'collected',
    'opere complete',
    'œuvres complètes',
    'sämtliche werke',
    'todo',
    'todas as',
    'all',
    'entire',
  ],
  COLLECTIONS_WITH: [
    'masterpieces',
    'collection',
    'selection',
    'treasury',
    'best of',
    'favorites',
    'favourites',
    'compilation',
    'various',
    'mehrere',
    'vários',
    'diversos',
  ],
  ARRANGEMENT: [
    'arr.',
    'arranged',
    'arrangement',
    'transcription',
    'adaptation',
    'version',
    'transcribed',
    'adapted',
  ],
  COLLECTION: [
    'set',
    'book',
    'volume',
    'cahier',
    'heft',
    'collection',
    'suite',
    'cycle',
  ],
  INDIVIDUAL: ['no.', 'number', 'nr.', '#', 'piece', 'movement'],
} as const;

/** Gênero de reserva, quando a página não permite concluir nada. */
export const UNDEFINED_GENRE = 'não definido';

export interface WorkDetails {
  opOrCatalog?: string;
  compositionYear?: string;
  firstPublishDate?: string;
  tone?: string;
  mediaDuration?: string;
  workStyle?: string;
  moviment?: string;
  instrumentation?: string;
  dedicateTo?: string;
  tempoMarking?: string;
}

/**
 * Normaliza a URL da página.
 *
 * Fragmento e query saem: `#Sheet_Music` e `?action=edit` apontam para a mesma
 * obra, e mantê-los faria a mesma página entrar duas vezes no catálogo com
 * `imslpPermlink` diferente.
 */
export function cleanImslpUrl(url: string): string {
  try {
    return decodeURIComponent(url).split('#')[0].split('?')[0];
  } catch {
    // URL com sequência de escape inválida: melhor devolver o original do que
    // perder a referência.
    return url.split('#')[0].split('?')[0];
  }
}

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/**
 * Tira do cabeçalho da página o nome do compositor que o IMSLP acrescenta.
 *
 * **Este defeito é meu, e nasceu na portabilidade.** O legado nunca lia o
 * título da página: ele vinha da API oficial de worklist, no campo
 * `intvals.worktitle`, já limpo — `"11 Bagatelles, Op.119"`. Ao portar, passei
 * a ler `#firstHeading`, que traz `"11 Bagatelles, Op.119 (Beethoven, Ludwig
 * van)"`. Duas consequências, as duas medidas contra o IMSLP real:
 *
 * 1. A obra entraria no catálogo com um título em formato diferente do das
 *    207.890 que já estão lá — e o título é justamente um dos dois critérios
 *    de duplicata.
 * 2. `extractSubtitle` cai no que está entre parênteses quando não há título
 *    alternativo na ficha. Com o compositor no fim do título, a Sonata ao
 *    Luar era raspada com `subtitle: "Beethoven, Ludwig van"`.
 *
 * O corte é **conferido, não adivinhado**: só sai o último grupo entre
 * parênteses, e só quando ele é igual ao compositor lido da própria página.
 * Assim um título que legitimamente termina em parênteses — `Sonata (Luar)` —
 * sobrevive, e sobrevive também o subtítulo que sai dele.
 */
export function stripComposerSuffix(
  heading: string,
  composerName: string | null,
): string {
  if (!composerName) {
    return heading;
  }

  const match = heading.match(/^(.*)\s*\(([^()]*)\)\s*$/);

  if (!match) {
    return heading;
  }

  const [, before, inside] = match;

  return normalizeForCompare(inside) === normalizeForCompare(composerName)
    ? before.trim()
    : heading;
}

/** Comparação tolerante a acento, caixa e espaço — o resto tem de bater. */
function normalizeForCompare(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normaliza o nome do compositor.
 *
 * Aspas tipográficas, reticências e travessões vêm da própria página e
 * atrapalham a comparação por nome na hora de achar o compositor no catálogo.
 */
export function cleanComposerName(name: string): string {
  if (!name) {
    return '';
  }

  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-');
}

/** Garante o prefixo `Category:` do permalink do compositor. */
export function cleanComposerPermLink(permLink: string): string {
  if (!permLink) {
    return '';
  }

  let cleaned: string;

  try {
    cleaned = decodeURIComponent(permLink).trim();
  } catch {
    cleaned = permLink.trim();
  }

  return cleaned.startsWith('Category:') ? cleaned : `Category:${cleaned}`;
}

/**
 * Variações do permalink, para a busca por compositor não falhar por escrita.
 *
 * Duas diferenças separam a página do catálogo, e as duas fazem a busca exata
 * falhar em silêncio:
 *
 * - **Acento.** O IMSLP escreve `Fauré` e o catálogo pode ter `Faure`.
 * - **Sublinhado.** A página dá `Category:Bach,_Johann_Sebastian`; o catálogo
 *   guarda `Category:Bach, Johann Sebastian`, com espaço. O legado só
 *   convertia espaço **em** sublinhado — nunca o contrário —, que é justamente
 *   a direção necessária. Medido contra o banco: a busca exata do Bach falhava,
 *   caía no `contains` por sobrenome, voltava **dez candidatos** e nenhum era
 *   escolhido. Quem casava era só o compositor de sobrenome único, por sorte.
 *
 * As duas se combinam, então são quatro formas.
 */
export function permLinkVariations(permLink: string): string[] {
  const spellings = [
    permLink,
    permLink.replace(/_/g, ' ').replace(/\s+/g, ' '),
    permLink.replace(/\s+/g, '_'),
  ];

  const withoutAccents = spellings.map((value) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );

  return [...new Set([...spellings, ...withoutAccents])];
}

/**
 * Identificadores da página.
 *
 * `urlId` é o nome da página, que é o identificador estável. `pageId` é o
 * número interno do MediaWiki, procurado em três lugares porque o IMSLP não o
 * publica de forma consistente — e é opcional justamente por isso.
 */
export function extractImslpWorkId(
  $: CheerioDocument,
  url: string,
): { urlId: string; pageId: string | null; cleanedUrl: string } {
  const urlParts = url.split('/wiki/');
  const urlId = urlParts.length > 1 ? urlParts[1] : '';

  const canonical = $('link[rel="canonical"]').attr('href');
  const fromCanonical = canonical?.match(/curid=(\d+)/)?.[1] ?? null;

  let pageId = fromCanonical;

  if (!pageId) {
    $('[data-mw-pageid], [data-pageid]').each((_, element) => {
      const id =
        $(element).attr('data-mw-pageid') ?? $(element).attr('data-pageid');

      if (id && /^\d+$/.test(id)) {
        pageId = id;
        return false;
      }

      return undefined;
    });
  }

  if (!pageId) {
    $('script').each((_, script) => {
      const content = $(script).html();

      const match =
        content?.match(/pageId["']?\s*:\s*["']?(\d+)["']?/i) ??
        content?.match(/wgArticleId["']?\s*:\s*["']?(\d+)["']?/i);

      if (match) {
        pageId = match[1];
        return false;
      }

      return undefined;
    });
  }

  return { urlId, pageId, cleanedUrl: cleanImslpUrl(url) };
}

/** Lê a ficha técnica da obra, linha a linha da tabela do IMSLP. */
export function extractWorkDetails($: CheerioDocument): WorkDetails {
  const details: WorkDetails = {};

  $('.wi_body table tr, .wp_header table tr').each((_, element) => {
    const row = $(element);
    const headerCell = row.find('th, td').first();
    const valueCell = row.find('td').last();

    if (!headerCell.length || !valueCell.length) {
      return;
    }

    const header = headerCell.text().trim().toLowerCase();
    const value = valueCell.text().trim();

    if (!value || value === '-') {
      return;
    }

    if (header.includes('opus') || header.includes('catalogue')) {
      details.opOrCatalog = value;
    } else if (header.includes('composition year')) {
      details.compositionYear = value;
    } else if (header.includes('first publication')) {
      details.firstPublishDate = value;
    } else if (header.includes('key')) {
      details.tone = value;
    } else if (header.includes('duration')) {
      details.mediaDuration = value;
    } else if (header.includes('style') || header.includes('period')) {
      details.workStyle = value;
    } else if (header.includes('movements') || header.includes('sections')) {
      details.moviment = value;
    } else if (
      header.includes('instrumentation') ||
      header.includes('scoring')
    ) {
      details.instrumentation = value;
    } else if (header.includes('dedication')) {
      details.dedicateTo = value;
    } else if (header.includes('tempo')) {
      details.tempoMarking = value;
    }
  });

  return details;
}

/** Título alternativo da ficha; na falta dele, o que está entre parênteses. */
export function extractSubtitle(
  title: string,
  $: CheerioDocument,
): string | null {
  let subtitle: string | null = null;

  $('.wp_header table tr').each((_, element) => {
    const row = $(element);
    const header = row.find('th').first().text().trim().toLowerCase();

    if (header.includes('alternative') && header.includes('title')) {
      subtitle = row.find('td').text().trim();
      return false;
    }

    return undefined;
  });

  if (!subtitle) {
    const parentheses = title.match(/\((.*?)\)/)?.[1];
    const quotes = title.match(/"(.*?)"/)?.[1];
    subtitle = parentheses ?? quotes ?? null;
  }

  return subtitle && String(subtitle).length > 0 ? subtitle : null;
}

/** Categorias reconhecidas, já traduzidas. O que não está no vocabulário sai. */
export function extractCategories($: CheerioDocument): string[] {
  const categories = new Set<string>();

  $('a[href*="Category:"]').each((_, element) => {
    const href = $(element).attr('href');
    const raw = href?.match(/Category:(.+)/)?.[1];

    if (!raw) {
      return;
    }

    const category = decodeSafely(raw)
      .replace(/_/g, ' ')
      .replace(/&transclude=.*$/, '')
      .trim();

    const translated =
      VALID_CATEGORIES[category] ?? VALID_CATEGORIES[category.toLowerCase()];

    if (translated) {
      categories.add(translated);
    }
  });

  return [...categories];
}

/**
 * Gêneros da obra, em três tentativas.
 *
 * Tabela de gêneros, depois links de categoria, e por último o próprio título.
 * Se nada resolver, entra `"não definido"` — explícito, em vez de uma lista
 * vazia que o resto do sistema teria de adivinhar como interpretar.
 */
export function extractWorkGenres($: CheerioDocument): string[] {
  const genres = new Set<string>();

  $('.wp_header table tr').each((_, element) => {
    const row = $(element);
    const header = row.find('th').first().text().trim().toLowerCase();

    if (header.includes('genre categories') || header.includes('categorias')) {
      row.find('td a').each((_index, link) => {
        const name = $(link).text().trim().toLowerCase();

        if (name && VALID_WORKGENRES.has(name)) {
          genres.add(WORK_GENRE_TRANSLATIONS[name] ?? name);
        }
      });
    }
  });

  $('a[href*="Category:"]').each((_, element) => {
    const raw = $(element)
      .attr('href')
      ?.match(/Category:(.+)/)?.[1];

    if (!raw) {
      return;
    }

    const category = decodeSafely(raw)
      .replace(/_/g, ' ')
      .replace(/&transclude=.*$/, '')
      .toLowerCase()
      .trim();

    if (VALID_WORKGENRES.has(category)) {
      genres.add(WORK_GENRE_TRANSLATIONS[category] ?? category);
    }
  });

  if (genres.size === 0) {
    const pageTitle = $('#firstHeading').text().toLowerCase();

    for (const [english, portuguese] of Object.entries(
      WORK_GENRE_TRANSLATIONS,
    )) {
      if (pageTitle.includes(english)) {
        genres.add(portuguese);
      }
    }
  }

  const found = [...genres].filter((genre) => genre.length > 0);

  return found.length > 0 ? found : [UNDEFINED_GENRE];
}

/**
 * Classifica a obra.
 *
 * A ordem dos testes importa e é a do legado: colaboração, obras completas,
 * coletânea, arranjo, coleção, peça individual. **O corpo da página só é
 * consultado quando o título não decide** — e é essa parte que a segunda cópia
 * do legado não tinha, o que fazia obras entrarem classificadas como
 * `INDIVIDUAL` por uma rota e como `COLLECTED_WORKS` pela outra.
 */
export function determineWorkType(
  title: string,
  $?: CheerioDocument,
): ImslpWorkType {
  const titleLower = title.toLowerCase();

  for (const keyword of WORK_TYPE_KEYWORDS.COLLABORATION) {
    if (
      titleLower.includes(keyword) &&
      /\b(with|and|&|feat\.)\s+[a-z]/i.test(titleLower)
    ) {
      return 'COLLABORATION';
    }
  }

  const byKeyword = (
    [
      ['COLLECTED_WORKS', WORK_TYPE_KEYWORDS.COLLECTED_WORKS],
      ['COLLECTIONS_WITH', WORK_TYPE_KEYWORDS.COLLECTIONS_WITH],
      ['ARRANGEMENT', WORK_TYPE_KEYWORDS.ARRANGEMENT],
      // Uma coleção nomeada ("set", "suite", "volume") entra como obra
      // completa, como no legado.
      ['COMPLETE_WORK', WORK_TYPE_KEYWORDS.COLLECTION],
      ['INDIVIDUAL', WORK_TYPE_KEYWORDS.INDIVIDUAL],
    ] as const
  ).find(([, keywords]) =>
    keywords.some((keyword) => titleLower.includes(keyword)),
  );

  if (byKeyword) {
    return byKeyword[0];
  }

  if ($) {
    const pageText = $('body').text().toLowerCase();

    const composerMentions = pageText.match(/composer[s]?:/gi);

    if (composerMentions && composerMentions.length > 1) {
      return 'COLLECTIONS_WITH';
    }

    if (
      pageText.includes('complete works') ||
      pageText.includes('collected works')
    ) {
      return 'COLLECTED_WORKS';
    }

    if (pageText.includes('collaboration') || pageText.includes('joint work')) {
      return 'COLLABORATION';
    }
  }

  return 'INDIVIDUAL';
}

/** Primeiro instrumento reconhecido no título, na instrumentação ou nas categorias. */
export function determinePrimaryInstrument(
  title: string,
  instrumentation?: string,
  categories?: string[],
): string | null {
  const text = [title, instrumentation ?? '', (categories ?? []).join(' ')]
    .join(' ')
    .toLowerCase();

  for (const [english, portuguese] of Object.entries(INSTRUMENT_MAPPING)) {
    if (text.includes(english)) {
      return portuguese;
    }
  }

  return null;
}

/**
 * Quão completa é a ficha, de 0 a 100.
 *
 * Serve à curadoria: uma obra com 20% de preenchimento entrou, mas precisa de
 * alguém. O legado calculava isto em cada rota, com listas de campos
 * diferentes.
 */
export function dataCompleteness(fields: Record<string, unknown>): number {
  const values = Object.values(fields);

  if (values.length === 0) {
    return 0;
  }

  const filled = values.filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0),
  ).length;

  return Math.round((filled / values.length) * 100);
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Campos que a portabilidade tinha deixado para trás.
//
// Auditoria do que `uploads/work/scraper` devolvia contra o que esta leitura
// devolvia: **seis funções não tinham sido portadas**, e três delas alimentam
// colunas que existem em `Work` e que ficariam vazias — `movementNumber`,
// `imslpTags` e `difficultyLevel`. As outras três traduzem para português dois
// campos que o catálogo inteiro guarda traduzidos.
//
// Medido no banco: `tone` é `"Dó maior"` em 11.353 obras e `"Sol maior"` em
// 10.988; `instrumentation` é `"Piano"` em 38.817 e `"Voz, Piano"` em 22.237;
// `difficultyLevel` está preenchido em 207.887 das 207.892 obras;
// `movementNumber` em 94.781; `imslpTags` em 207.881. Escrever em inglês, ou
// deixar em branco, seria pôr a obra nova fora da convenção de todas as outras.
// ---------------------------------------------------------------------------

/**
 * A tonalidade em português: "C-sharp minor" vira "Dó# menor".
 *
 * **A expressão do legado não alcançava metade da própria tabela.** Ela era
 * `/^([A-G][#b]?)\s*(major|minor|...)$/i`: só aceitava o acidente escrito como
 * `#` ou `b`. Mas `NOTE_TRANSLATIONS` traz também `'C-sharp': 'Dó#'`,
 * `'B-flat': 'Sib'` e mais onze na forma por extenso — **treze entradas que o
 * código nunca conseguia usar** —, e é justamente por extenso que o IMSLP
 * escreve. Resultado medido no catálogo: 7.903 obras com a tonalidade em
 * inglês, e as mais comuns entre elas são exatamente essas —
 * "F-sharp minor" (621), "B-flat minor" (488), "C-sharp minor" (445),
 * "E-flat minor" (316).
 */
export function translateMusicKey(key?: string | null): string | null {
  if (!key) {
    return null;
  }

  const match = key.match(
    /^([A-G](?:#|b|-sharp|-flat)?)\s*(major|minor|maj|min|M|m)?$/i,
  );

  if (!match) {
    // Tonalidade que não segue o padrão volta como está: melhor o texto da
    // página do que nada.
    return key;
  }

  const [, note, mode] = match;
  // A tabela é indexada pela forma canônica ("C-sharp"); a página pode
  // escrever em qualquer caixa.
  const canonical = note.charAt(0).toUpperCase() + note.slice(1).toLowerCase();
  const translatedNote = NOTE_TRANSLATIONS[canonical] ?? note;

  if (!mode) {
    return translatedNote;
  }

  const translatedMode =
    MODE_TRANSLATIONS[mode.toLowerCase()] ?? mode.toLowerCase();

  return `${translatedNote} ${translatedMode}`;
}

/** A instrumentação em português: "voice, piano" vira "Voz, Piano". */
export function translateInstrumentation(
  instrumentation?: string | null,
): string | null {
  if (!instrumentation) {
    return null;
  }

  const translated = Object.entries(INSTRUMENT_MAPPING).reduce(
    (text, [english, portuguese]) =>
      text.replace(new RegExp(`\\b${english}\\b`, 'gi'), portuguese),
    instrumentation.toLowerCase(),
  );

  return translated.charAt(0).toUpperCase() + translated.slice(1);
}

/**
 * Todas as categorias da página, como etiquetas.
 *
 * Diferente de `extractCategories`: aqui **nada é filtrado pelo vocabulário**.
 * `categoryNames` guarda o que a plataforma reconhece e traduz; `imslpTags`
 * guarda o que o IMSLP diz, cru, para quem quiser procurar por isso depois.
 */
export function extractImslpTags($: CheerioDocument): string[] {
  const tags = new Set<string>();

  $('a[href*="Category:"]').each((_, element) => {
    const raw = $(element)
      .attr('href')
      ?.match(/Category:(.+)/)?.[1];

    if (raw) {
      tags.add(decodeSafely(raw).replace(/_/g, ' '));
    }
  });

  return [...tags];
}

/**
 * Quantos movimentos a obra tem.
 *
 * **As duas metades do legado discordam sobre o que este campo significa, e o
 * catálogo desempata.** A rota `uploads/work/scraper` lia `No.\d+` do título:
 * para a Sonata ao Luar — "Piano Sonata No.14" — ela devolvia **14**, que é o
 * número da sonata na obra de Beethoven, não um movimento. O script de carga
 * que preencheu o banco lia o número que abre o campo `moviment`
 * ("3 movements:", "13 movements:") e gravava a **contagem**. Medido nas 94.781
 * obras com o campo preenchido, é a contagem que está lá: a Sonata ao Luar tem
 * `movementNumber: 3` e `moviment: "3 movements: Adagio sostenuto..."`.
 *
 * Ficou a contagem. Gravar 14 numa coluna onde as outras 94.781 linhas dizem
 * "quantos movimentos" não é paridade com o legado — é escolher a metade dele
 * que contradiz o banco.
 */
export function extractMovementNumber(moviment?: string | null): number | null {
  const count = moviment?.trim().match(/^(\d+)/)?.[1];

  return count ? Number(count) : null;
}

export type DifficultyLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

const BEGINNER_TITLE_WORDS = [
  'easy',
  'simple',
  'first',
  'elementary',
  'children',
  'student',
  'lesson',
  'exercise',
  'étude facile',
  'fácil',
  'iniciante',
  'beginner',
  'albumblätter',
  'lyric pieces',
];

const ADVANCED_TITLE_WORDS = [
  'concert',
  'concerto',
  'virtuoso',
  'transcendental',
  'paganini',
  'liszt',
  'chopin etude',
  'ballad',
  'scherzo',
  'sonata',
  'rhapsody',
  'fantasy',
  'variations',
  'toccata',
];

const BEGINNER_GENRES = ['estudos', 'exercícios', 'minuetos', 'danças simples'];
const ADVANCED_GENRES = [
  'concertos',
  'sonatas',
  'rapsódias',
  'fantasias',
  'baladas',
];

const EASY_OPUS = 10;
const HARD_OPUS = 50;

/**
 * Nível de dificuldade, na escala que o catálogo usa.
 *
 * **É um palpite grosseiro, e o catálogo inteiro foi preenchido com ele**:
 * 147.660 obras estão como INTERMEDIATE, que é o valor de quando nada decide.
 * A regra do número de opus — "op. até 10 é fácil, de 50 para cima é difícil" —
 * não tem fundamento musical nenhum; ela mede quando a obra foi publicada, não
 * quão difícil é tocá-la. Ficou como estava porque mudá-la faria a obra nova
 * discordar das 207 mil já classificadas, e porque `WorkScore` tem a
 * dificuldade real do IMSLP (`difficultySystem`, `difficultyRating`) para quem
 * precisa do número sério.
 */
export function determineDifficultyLevel(
  title: string,
  opOrCatalog: string | null | undefined,
  workGenres: string[],
): DifficultyLevel {
  const titleLower = title.toLowerCase();

  if (BEGINNER_TITLE_WORDS.some((word) => titleLower.includes(word))) {
    return 'BEGINNER';
  }

  if (ADVANCED_TITLE_WORDS.some((word) => titleLower.includes(word))) {
    return 'ADVANCED';
  }

  const opus = Number(opOrCatalog?.match(/op\.?\s*(\d+)/i)?.[1]);

  if (opus) {
    if (opus <= EASY_OPUS) {
      return 'BEGINNER';
    }

    if (opus >= HARD_OPUS) {
      return 'ADVANCED';
    }
  }

  for (const genre of workGenres) {
    const genreLower = genre.toLowerCase();

    if (BEGINNER_GENRES.some((value) => genreLower.includes(value))) {
      return 'BEGINNER';
    }

    if (ADVANCED_GENRES.some((value) => genreLower.includes(value))) {
      return 'ADVANCED';
    }
  }

  return 'INTERMEDIATE';
}

/** A época a que o estilo declarado na página corresponde. */
export function mapStyleToEpoch(style?: string | null): string | null {
  if (!style) {
    return null;
  }

  return EPOCH_STYLE_MAPPING[style.toLowerCase().trim()] ?? null;
}

/** Qualidade da ficha, pelas mesmas faixas do resto da plataforma. */
export function pageQualityOf(dataCompleteness: number): string {
  if (dataCompleteness >= 80) {
    return 'high';
  }

  return dataCompleteness >= 60 ? 'medium' : 'low';
}
