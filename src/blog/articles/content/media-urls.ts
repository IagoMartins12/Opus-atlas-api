/**
 * Endereços de arquivo que o conteúdo de um artigo referencia.
 *
 * O editor guarda arquivo em quatro blocos — imagem, player de áudio, citação
 * com música de fundo e cartão de compositor — e na imagem de cada evento da
 * linha do tempo. Saber quais são serve a três coisas: a galeria mostrar onde
 * cada arquivo é usado, a gravação do artigo adotar os arquivos enviados antes
 * de ele existir, e a migração do disco do legado reescrever o endereço.
 */

const URL_ATTRS: Record<string, readonly string[]> = {
  image: ['src'],
  audioPlayer: ['audioUrl'],
  quoteMusical: ['backgroundAudioUrl'],
  composerCard: ['composerImage'],
};

type Holder = Record<string, unknown>;

function visit(node: unknown, onUrl: (holder: Holder, key: string) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, onUrl));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const current = node as Holder;
  const type = typeof current.type === 'string' ? current.type : null;
  const attrs =
    current.attrs && typeof current.attrs === 'object'
      ? (current.attrs as Holder)
      : null;

  if (type && attrs) {
    for (const key of URL_ATTRS[type] ?? []) {
      onUrl(attrs, key);
    }

    if (type === 'timeline' && Array.isArray(attrs.events)) {
      for (const event of attrs.events) {
        if (event && typeof event === 'object') {
          onUrl(event as Holder, 'image');
        }
      }
    }
  }

  if (Array.isArray(current.content)) {
    visit(current.content, onUrl);
  }
}

/** Todos os endereços de arquivo do conteúdo, sem repetição. */
export function collectMediaUrls(doc: unknown): string[] {
  const urls = new Set<string>();

  visit(doc, (holder, key) => {
    const value = holder[key];

    if (typeof value === 'string' && value.trim()) {
      urls.add(value.trim());
    }
  });

  return [...urls];
}

/** Uma cópia do conteúdo com um endereço trocado por outro. */
export function replaceMediaUrl(
  doc: unknown,
  from: string,
  to: string,
): { doc: unknown; replaced: number } {
  const copy: unknown = JSON.parse(JSON.stringify(doc ?? null));
  let replaced = 0;

  visit(copy, (holder, key) => {
    if (holder[key] === from) {
      holder[key] = to;
      replaced += 1;
    }
  });

  return { doc: copy, replaced };
}

/** Blocos que só existem para mostrar o arquivo: sem ele, saem inteiros. */
const FILE_ONLY_BLOCKS = new Set(['image', 'audioPlayer']);

/**
 * Uma cópia do conteúdo sem os arquivos perdidos.
 *
 * Imagem e player de áudio saem inteiros — um bloco de imagem sem imagem é um
 * buraco na página. Nos blocos que têm mais do que o arquivo (cartão de
 * compositor, citação com música, evento da linha do tempo), só o endereço vira
 * `null` e o resto fica.
 */
export function dropMediaUrls(
  doc: unknown,
  isLost: (url: string) => boolean,
): { doc: unknown; dropped: string[] } {
  const copy: unknown = JSON.parse(JSON.stringify(doc ?? null));
  const dropped: string[] = [];

  const lost = (value: unknown): value is string =>
    typeof value === 'string' && !!value.trim() && isLost(value.trim());

  /** `false` quando o nó inteiro deve sair. */
  const keep = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return true;
    }

    const current = node as Holder;
    const type = typeof current.type === 'string' ? current.type : null;
    const attrs =
      current.attrs && typeof current.attrs === 'object'
        ? (current.attrs as Holder)
        : null;

    if (type && attrs) {
      for (const key of URL_ATTRS[type] ?? []) {
        const value = attrs[key];

        if (lost(value)) {
          dropped.push(value.trim());

          if (FILE_ONLY_BLOCKS.has(type)) {
            return false;
          }

          attrs[key] = null;
        }
      }

      if (type === 'timeline' && Array.isArray(attrs.events)) {
        for (const event of attrs.events) {
          const holder = event as Holder | null;

          if (holder && typeof holder === 'object' && lost(holder.image)) {
            dropped.push(holder.image.trim());
            holder.image = null;
          }
        }
      }
    }

    if (Array.isArray(current.content)) {
      current.content = current.content.filter(keep);
    }

    return true;
  };

  keep(copy);
  return { doc: copy, dropped };
}
