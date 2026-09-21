import { isMongoId } from 'class-validator';

/**
 * Política do conteúdo de artigo.
 *
 * **O conteúdo não é HTML, e por isso `sanitize-html` não serve aqui.** O
 * editor do blog é o TipTap, e o que ele grava em `BlogArticle.content` é o
 * JSON do ProseMirror: uma árvore de nós (`paragraph`, `heading`, `image`…) com
 * atributos. Medido nas matérias da base: nenhuma string com marcação HTML. Um
 * sanitizador de HTML passaria por esse JSON sem achar nada para limpar — e o
 * perigo continuaria todo lá, porque ele mora nos **atributos**.
 *
 * **O leitor do blog no front monta a página com `innerHTML`.** O componente
 * `ArticleContent` não passa pelo React: ele concatena os atributos dos blocos
 * em strings de HTML (`<a href="${scoreUrl}">`, `<img src="${event.image}"
 * alt="${event.title}">`, `— ${author}`) e atribui `a.href` e `iframe.src`
 * direto do JSON. A proteção do React 19 contra `javascript:` não alcança nada
 * disso. Sem esta política, qualquer atributo de bloco é XSS armazenado na
 * página pública.
 *
 * Por isso a defesa é uma **lista fechada**, aplicada no momento da escrita:
 *
 * - **tipo de nó e de marca desconhecido é recusado**, não removido — remover
 *   em silêncio faria parte do texto do autor sumir sem ele saber;
 * - **atributo desconhecido é descartado** — atributo é metadado do editor, não
 *   texto de ninguém, e descartá-lo não perde conteúdo;
 * - cada atributo conhecido é validado **pelo contexto em que o leitor o
 *   exibe**: id é `ObjectId`, endereço passa por lista fechada de protocolo (e
 *   de host, no YouTube), e texto que vai para `innerHTML` não aceita `<` nem
 *   `>`. O único que o leitor põe **dentro de um atributo HTML** (`alt` do
 *   evento da linha do tempo) também não aceita aspas.
 *
 * O texto corrido do artigo (nó `text`) não tem restrição: o leitor o insere
 * com `createTextNode`, que não interpreta marcação.
 */

export class ArticleContentError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'ArticleContentError';
  }
}

export const CONTENT_LIMITS = {
  /** A maior matéria da base tem 60 KB. Um megabyte é folga de quinze vezes. */
  maxBytes: 1_000_000,
  maxDepth: 24,
  /** A maior matéria da base tem cerca de mil e quinhentos nós. */
  maxNodes: 20_000,
  maxText: 100_000,
  maxAttrText: 2_000,
  maxLongAttrText: 10_000,
  maxMarks: 10,
  maxTimelineEvents: 100,
  maxUrl: 2_048,
} as const;

export interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  marks?: ContentMark[];
  text?: string;
}

export interface ContentMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface SanitizedContent {
  doc: ContentNode;
  /** Palavras do texto corrido — é o que o tempo de leitura usa. */
  words: number;
}

/** Documento vazio, no formato que o editor produz. */
export function emptyDoc(): ContentNode {
  return { type: 'doc', content: [] };
}

// ---------------------------------------------------------------------------
// Regras de atributo
// ---------------------------------------------------------------------------

type Rule = (value: unknown, path: string) => unknown;

export type UrlKind = 'link' | 'media' | 'youtube' | 'media-or-youtube';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/**
 * Caminho do próprio site (`/uploads/...`).
 *
 * `//host` é recusado: o navegador lê isso como endereço **de outro site** com
 * o protocolo da página, e é a forma clássica de escapar de uma checagem que
 * só olha "começa com barra".
 */
const SITE_PATH = /^\/(?![/\\])[^\s"'<>\\`]*$/;

const ANCHOR = /^#[\w-]*$/;

const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

function fail(path: string, reason: string): never {
  throw new ArticleContentError(path, reason);
}

const isAbsent = (value: unknown) => value === null || value === undefined;

/**
 * Valida um endereço e devolve a forma normalizada.
 *
 * Endereço absoluto volta **reserializado pelo `URL`**, que codifica aspas,
 * espaço e sinais de menor e maior. É o que impede um `"` de fechar o
 * `href="..."` que o leitor monta por concatenação.
 */
export function checkUrl(value: string, kind: UrlKind, path: string): string {
  const trimmed = value.trim();

  if (trimmed === '') {
    return '';
  }

  if (trimmed.length > CONTENT_LIMITS.maxUrl) {
    fail(path, `endereço com mais de ${CONTENT_LIMITS.maxUrl} caracteres`);
  }

  if (kind === 'link' && ANCHOR.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    if (kind === 'youtube') {
      fail(path, 'precisa ser um endereço do YouTube');
    }

    if (!SITE_PATH.test(trimmed)) {
      fail(path, 'caminho relativo inválido');
    }

    return trimmed;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return fail(path, 'não é um endereço válido');
  }

  if (parsed.username || parsed.password) {
    fail(path, 'endereço com usuário ou senha embutidos');
  }

  const protocols =
    kind === 'link' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];

  if (!protocols.includes(parsed.protocol)) {
    fail(
      path,
      `protocolo não aceito: "${parsed.protocol}". Aceitos: ${protocols.join(', ')}`,
    );
  }

  if (
    kind === 'youtube' &&
    (parsed.protocol !== 'https:' || !YOUTUBE_HOSTS.has(parsed.hostname))
  ) {
    fail(path, 'precisa ser um endereço https do YouTube');
  }

  return parsed.href;
}

function url(kind: UrlKind): Rule {
  return (value, path) => {
    if (isAbsent(value)) return null;
    if (typeof value !== 'string') return fail(path, 'precisa ser texto');
    return checkUrl(value, kind, path);
  };
}

/**
 * Texto de atributo.
 *
 * `<` e `>` são recusados porque o leitor insere estes campos com `innerHTML`.
 * Com `forbidQuote`, as aspas também: é o caso de campo que o leitor põe dentro
 * de um atributo HTML, onde uma aspa basta para sair dele.
 */
function text(
  max: number = CONTENT_LIMITS.maxAttrText,
  options: { forbidQuote?: boolean } = {},
): Rule {
  return (value, path) => {
    if (isAbsent(value)) return null;
    if (typeof value !== 'string') return fail(path, 'precisa ser texto');

    if (value.length > max) {
      fail(path, `texto com mais de ${max} caracteres`);
    }

    if (/[<>]/.test(value)) {
      fail(
        path,
        'não pode conter "<" nem ">" — o leitor do blog exibe este campo como HTML. Use « » ou ‹ ›.',
      );
    }

    if (options.forbidQuote && value.includes('"')) {
      fail(
        path,
        'não pode conter aspas duplas — o leitor do blog põe este campo dentro de um atributo HTML. Use “ ” ou aspas simples.',
      );
    }

    return value;
  };
}

function oneOf(values: readonly unknown[]): Rule {
  return (value, path) => {
    if (isAbsent(value)) return null;
    if (values.includes(value)) return value;

    return fail(
      path,
      `valor não aceito: ${JSON.stringify(value)}. Aceitos: ${values
        .map((allowed) => JSON.stringify(allowed))
        .join(', ')}`,
    );
  };
}

function intIn(min: number, max: number): Rule {
  return (value, path) => {
    if (isAbsent(value) || value === '') return null;

    const numeric =
      typeof value === 'string' && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : value;

    if (
      typeof numeric !== 'number' ||
      !Number.isInteger(numeric) ||
      numeric < min ||
      numeric > max
    ) {
      fail(path, `precisa ser um inteiro entre ${min} e ${max}`);
    }

    return numeric;
  };
}

const bool: Rule = (value, path) => {
  if (isAbsent(value)) return null;
  if (typeof value === 'boolean') return value;
  return fail(path, 'precisa ser verdadeiro ou falso');
};

function token(pattern: RegExp): Rule {
  return (value, path) => {
    if (isAbsent(value) || value === '') return null;

    if (typeof value !== 'string' || !pattern.test(value)) {
      fail(path, `formato não aceito: ${JSON.stringify(value)}`);
    }

    return value;
  };
}

/**
 * Id de compositor ou obra.
 *
 * O leitor monta `<a href="/composer/${composerId}">` por concatenação: sem
 * esta checagem, um id com aspas sai do atributo.
 */
const objectId: Rule = (value, path) => {
  if (isAbsent(value) || value === '') return null;

  if (typeof value !== 'string' || !isMongoId(value)) {
    fail(path, 'precisa ser um id do catálogo (ObjectId)');
  }

  return value;
};

const color: Rule = token(
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[\d.,%\s]+\)|[a-z]{3,20})$/i,
);

/** Objeto com campos conhecidos; os desconhecidos são descartados. */
function shape(fields: Record<string, Rule>): Rule {
  return (value, path) => {
    if (isAbsent(value)) return null;

    if (typeof value !== 'object' || Array.isArray(value)) {
      fail(path, 'precisa ser um objeto');
    }

    return cleanAttrs(value as Record<string, unknown>, fields, path);
  };
}

function listOf(item: Rule, max: number): Rule {
  return (value, path) => {
    if (isAbsent(value)) return [];
    if (!Array.isArray(value)) return fail(path, 'precisa ser uma lista');
    if (value.length > max) fail(path, `mais de ${max} itens`);
    return value.map((entry, index) => item(entry, `${path}[${index}]`));
  };
}

const TEXT = text();
const LONG_TEXT = text(CONTENT_LIMITS.maxLongAttrText);
/**
 * Largura e altura de imagem.
 *
 * Aceita texto com unidade porque é o que a base tem: medido, uma das imagens
 * publicadas grava `height: "300px"`. Uma regra só de inteiro recusaria uma
 * matéria que já está no ar.
 */
const DIMENSION: Rule = (value, path) => {
  if (isAbsent(value) || value === '') return null;

  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 10_000
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    /^\d{1,5}(\.\d+)?(px|%)?$/.test(value.trim())
  ) {
    return value.trim();
  }

  return fail(path, 'precisa ser um tamanho: número, "300px" ou "50%"');
};

const SCORE_ID = token(/^[\w.:-]{1,120}$/);

const TIMELINE_EVENT = shape({
  id: token(/^[\w.:-]{1,100}$/),
  date: text(100),
  // O leitor escreve `alt="${event.title}"`: aqui a aspa fecha o atributo.
  title: text(300, { forbidQuote: true }),
  description: LONG_TEXT,
  image: url('media'),
});

const VIDEO = shape({
  url: url('youtube'),
  title: text(300),
  description: LONG_TEXT,
});

// ---------------------------------------------------------------------------
// Tipos aceitos
// ---------------------------------------------------------------------------

/**
 * Os nós que o editor do blog produz, e os atributos de cada um.
 *
 * É a configuração do `BlogEditor` do front: o `StarterKit` (títulos de nível
 * 1 a 3), imagem, YouTube, alinhamento, cor, e os sete blocos próprios da
 * plataforma. Um nó fora daqui não foi produzido pelo editor.
 */
const NODE_ATTRS: Record<string, Record<string, Rule>> = {
  doc: {},
  text: {},
  paragraph: { textAlign: oneOf(ALIGNMENTS) },
  // O leitor monta a tag com `h${level}`: um nível fora da lista não é XSS,
  // mas é `createElement` com nome inválido — a página do artigo cai inteira.
  heading: { level: oneOf([1, 2, 3]), textAlign: oneOf(ALIGNMENTS) },
  blockquote: {},
  bulletList: {},
  orderedList: {
    start: intIn(1, 100_000),
    type: oneOf(['1', 'a', 'A', 'i', 'I']),
  },
  listItem: {},
  codeBlock: { language: token(/^[a-z0-9+#._-]{1,30}$/i) },
  hardBreak: {},
  horizontalRule: {},
  image: {
    src: url('media'),
    alt: TEXT,
    title: TEXT,
    width: DIMENSION,
    height: DIMENSION,
  },
  youtube: {
    src: url('youtube'),
    start: intIn(0, 86_400),
    width: DIMENSION,
    height: DIMENSION,
  },
  composerCard: {
    composerId: objectId,
    composerName: TEXT,
    composerImage: url('media'),
    composerBio: LONG_TEXT,
    composerBirthDate: text(100),
    composerDeathDate: text(100),
    composerNationality: text(200),
    composerInstrumentation: text(500),
    composerEpoch: text(200),
    composerWikipediaLink: url('link'),
    layout: oneOf(['vertical', 'horizontal']),
    showWorksButton: bool,
  },
  workCard: {
    workId: objectId,
    workTitle: TEXT,
    composerName: TEXT,
    instrumentName: TEXT,
  },
  scoreViewer: {
    workId: objectId,
    scoreId: SCORE_ID,
    scoreUrl: url('media'),
    scoreTitle: TEXT,
    workTitle: TEXT,
    composerName: TEXT,
    pageNumber: intIn(1, 10_000),
    allowDownload: bool,
  },
  audioPlayer: {
    audioUrl: url('media-or-youtube'),
    audioType: oneOf(['upload', 'youtube']),
    title: TEXT,
    composerId: objectId,
    composerName: TEXT,
    workId: objectId,
    workTitle: TEXT,
  },
  timeline: {
    events: listOf(TIMELINE_EVENT, CONTENT_LIMITS.maxTimelineEvents),
    composerId: objectId,
    composerName: TEXT,
  },
  videoComparison: {
    title: TEXT,
    video1: VIDEO,
    video2: VIDEO,
    layout: token(/^[a-z-]{1,30}$/),
    syncPlayback: bool,
  },
  quoteMusical: {
    quote: LONG_TEXT,
    author: TEXT,
    backgroundAudioUrl: url('media-or-youtube'),
    backgroundAudioType: oneOf(['upload', 'youtube']),
    backgroundAudioVolume: intIn(0, 100),
  },
};

const MARK_ATTRS: Record<string, Record<string, Rule>> = {
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: {},
  link: {
    // O leitor faz `a.href = mark.attrs.href`: é aqui que um `javascript:`
    // viraria clique executando script.
    href: url('link'),
    target: oneOf(['_blank', '_self']),
    rel: token(/^[a-z ]{0,60}$/i),
    class: token(/^[\w\s:/.-]{0,200}$/),
  },
  textStyle: { color },
};

/** Tipos aceitos, para documentação e mensagens. */
export const ALLOWED_NODE_TYPES = Object.keys(NODE_ATTRS);
export const ALLOWED_MARK_TYPES = Object.keys(MARK_ATTRS);

// ---------------------------------------------------------------------------
// Percurso
// ---------------------------------------------------------------------------

interface WalkState {
  nodes: number;
  words: number;
}

/**
 * Valida e limpa o conteúdo de um artigo.
 *
 * Devolve a árvore limpa e a contagem de palavras do texto corrido. Lança
 * `ArticleContentError` com o **caminho** do problema
 * (`content.content[12].attrs.src`), para quem escreve saber qual bloco
 * corrigir.
 */
export function sanitizeArticleContent(raw: unknown): SanitizedContent {
  if (isAbsent(raw)) {
    return { doc: emptyDoc(), words: 0 };
  }

  const bytes = Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');

  if (bytes > CONTENT_LIMITS.maxBytes) {
    fail(
      'content',
      `conteúdo com ${bytes} bytes; o limite é ${CONTENT_LIMITS.maxBytes}`,
    );
  }

  const state: WalkState = { nodes: 0, words: 0 };
  const doc = cleanNode(raw, 'content', 0, state);

  if (doc.type !== 'doc') {
    fail('content.type', 'o conteúdo precisa começar por um nó "doc"');
  }

  return { doc, words: state.words };
}

function cleanNode(
  value: unknown,
  path: string,
  depth: number,
  state: WalkState,
): ContentNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'precisa ser um nó (objeto com "type")');
  }

  if (depth > CONTENT_LIMITS.maxDepth) {
    fail(path, `aninhamento acima de ${CONTENT_LIMITS.maxDepth} níveis`);
  }

  state.nodes += 1;

  if (state.nodes > CONTENT_LIMITS.maxNodes) {
    fail(path, `mais de ${CONTENT_LIMITS.maxNodes} nós no conteúdo`);
  }

  const node = value as Record<string, unknown>;
  const type = node.type;

  if (typeof type !== 'string' || !(type in NODE_ATTRS)) {
    fail(
      `${path}.type`,
      `tipo de bloco desconhecido: ${JSON.stringify(type)}. O editor do blog não produz esse bloco.`,
    );
  }

  const clean: ContentNode = { type };

  if (type === 'text') {
    if (typeof node.text !== 'string') {
      fail(`${path}.text`, 'nó de texto sem texto');
    }

    if (node.text.length > CONTENT_LIMITS.maxText) {
      fail(
        `${path}.text`,
        `trecho com mais de ${CONTENT_LIMITS.maxText} caracteres`,
      );
    }

    clean.text = node.text;
    state.words += countWords(node.text);

    const textMarks = cleanMarks(node.marks, path);
    if (textMarks) clean.marks = textMarks;

    return clean;
  }

  if (node.attrs !== undefined && node.attrs !== null) {
    if (typeof node.attrs !== 'object' || Array.isArray(node.attrs)) {
      fail(`${path}.attrs`, 'precisa ser um objeto');
    }

    clean.attrs = cleanAttrs(
      node.attrs as Record<string, unknown>,
      NODE_ATTRS[type],
      `${path}.attrs`,
    );
  }

  // Nó em linha que não é texto também carrega marca. Medido na base: uma
  // quebra de linha dentro de trecho em negrito grava `marks: [{ type: 'bold' }]`.
  // Descartá-la mudaria o documento do autor — que é o que a política promete
  // não fazer com nada além de metadado desconhecido.
  const marks = cleanMarks(node.marks, path);
  if (marks) clean.marks = marks;

  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      fail(`${path}.content`, 'precisa ser uma lista de nós');
    }

    clean.content = node.content.map((child, index) =>
      cleanNode(child, `${path}.content[${index}]`, depth + 1, state),
    );
  }

  return clean;
}

function cleanMarks(value: unknown, path: string): ContentMark[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return fail(`${path}.marks`, 'precisa ser uma lista');
  }

  if (value.length > CONTENT_LIMITS.maxMarks) {
    fail(`${path}.marks`, `mais de ${CONTENT_LIMITS.maxMarks} marcas`);
  }

  return value.map((mark, index) => cleanMark(mark, `${path}.marks[${index}]`));
}

function cleanMark(value: unknown, path: string): ContentMark {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'precisa ser uma marca (objeto com "type")');
  }

  const mark = value as Record<string, unknown>;
  const type = mark.type;

  if (typeof type !== 'string' || !(type in MARK_ATTRS)) {
    fail(
      `${path}.type`,
      `formatação desconhecida: ${JSON.stringify(type)}. O editor do blog não produz essa marca.`,
    );
  }

  const clean: ContentMark = { type };

  if (mark.attrs !== undefined && mark.attrs !== null) {
    if (typeof mark.attrs !== 'object' || Array.isArray(mark.attrs)) {
      fail(`${path}.attrs`, 'precisa ser um objeto');
    }

    clean.attrs = cleanAttrs(
      mark.attrs as Record<string, unknown>,
      MARK_ATTRS[type],
      `${path}.attrs`,
    );
  }

  return clean;
}

function cleanAttrs(
  attrs: Record<string, unknown>,
  rules: Record<string, Rule>,
  path: string,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, rule] of Object.entries(rules)) {
    if (key in attrs) {
      clean[key] = rule(attrs[key], `${path}.${key}`);
    }
  }

  return clean;
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
