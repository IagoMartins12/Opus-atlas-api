/**
 * O texto que o áudio "ouvir o artigo" lê.
 *
 * **Sai do artigo, no servidor.** No legado o texto vinha do navegador, na
 * requisição, e era isso que o Google lia e o site gravava como o áudio do
 * artigo. Sem autenticação na rota, qualquer pessoa trocava o áudio de uma
 * matéria pelo texto que quisesse: a página continuava lá, e o "ouvir"
 * falava outra coisa.
 */

type Node = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
};

/** Blocos cujo texto corrido vira uma frase própria. */
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote']);

function textOf(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child) => textOf(child, out));
    return;
  }

  if (!node || typeof node !== 'object') return;

  const current = node as Node;

  if (current.type === 'text' && typeof current.text === 'string') {
    out.push(current.text);
    return;
  }

  if (current.type === 'hardBreak') {
    out.push(' ');
    return;
  }

  // Código não se lê em voz alta.
  if (current.type === 'codeBlock') return;

  if (current.type === 'quoteMusical' && current.attrs) {
    const { quote, author } = current.attrs;
    if (typeof quote === 'string' && quote.trim()) {
      out.push(
        sentence(
          typeof author === 'string' && author.trim()
            ? `${quote} — ${author}`
            : quote,
        ),
      );
    }
    return;
  }

  if (typeof current.type === 'string' && BLOCKS.has(current.type)) {
    const inner: string[] = [];
    textOf(current.content, inner);
    const joined = inner.join('').trim();
    if (joined) out.push(sentence(joined));
    return;
  }

  textOf(current.content, out);
}

/** Termina com pontuação, para a voz fazer a pausa. */
function sentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return /[.!?…:;]$/.test(trimmed) ? `${trimmed} ` : `${trimmed}. `;
}

export function articleSpeechText(article: {
  title: string;
  description: string | null;
  content: unknown;
}): string {
  const parts: string[] = [sentence(article.title)];

  if (article.description?.trim()) {
    parts.push(sentence(article.description));
  }

  textOf(article.content, parts);

  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Limite do Google por requisição: 5.000 **bytes**, com folga. */
export const MAX_CHUNK_BYTES = 4500;

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * Divide o texto em pedaços que o Google aceita.
 *
 * **O legado cortava por caracteres (4.000), e o limite do Google é em
 * bytes.** Em português, cada letra acentuada ocupa dois bytes em UTF-8: um
 * trecho de 4.000 caracteres pode passar dos 5.000 bytes e ser recusado. Aqui a
 * conta é em bytes, frase a frase, e frase grande demais é quebrada por
 * palavra.
 */
export function splitForSpeech(
  text: string,
  maxBytes = MAX_CHUNK_BYTES,
): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const raw of sentences) {
    const part = raw.trim();
    if (!part) continue;

    if (bytes(part) > maxBytes) {
      push();

      for (const word of part.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;

        if (bytes(candidate) > maxBytes) {
          push();
          current = word;
        } else {
          current = candidate;
        }
      }

      push();
      continue;
    }

    const candidate = current ? `${current} ${part}` : part;

    if (bytes(candidate) > maxBytes) {
      push();
      current = part;
    } else {
      current = candidate;
    }
  }

  push();
  return chunks;
}
