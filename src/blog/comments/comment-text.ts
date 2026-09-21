/**
 * Texto de comentário.
 *
 * **O comentário é texto puro, e por isso não passa por `sanitize-html`.** O
 * front escreve num `<textarea>` e exibe com `{comment.content}` no JSX, com
 * `whitespace-pre-wrap` — o React escapa tudo. Não há HTML em lugar nenhum do
 * caminho. Rodar um sanitizador de HTML aqui não protegeria nada e estragaria
 * texto legítimo: "a < b" seria gravado como `a &lt; b`, e o React, que escapa
 * de novo na tela, mostraria `&lt;` literalmente. Sanitizar texto puro é
 * escapar duas vezes.
 *
 * O contrato é o inverso: o texto é gravado como foi escrito, e **quem exibe é
 * responsável por escapar**. O que se limpa aqui não é marcação, é o que não é
 * texto de ninguém:
 *
 * - quebras de linha do Windows e do Mac antigo viram `\n`;
 * - caracteres de controle somem (fora quebra de linha e tabulação);
 * - **caracteres de direção bidirecional somem** (U+202A a U+202E e U+2066 a
 *   U+2069): com eles, um comentário exibe um texto e contém outro — é a
 *   técnica que faz `moc.elpmaxe` aparecer como `example.com`;
 * - três ou mais linhas em branco seguidas viram duas, para ninguém ocupar a
 *   tela inteira com espaço vazio.
 */

export const COMMENT_MIN_LENGTH = 3;
export const COMMENT_MAX_LENGTH = 2000;

/** Controles C0 (menos tabulação e quebra), DEL e os de direção bidirecional. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function normalizeCommentText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Por que o texto não serve — ou `null`. */
export function commentLengthError(text: string): string | null {
  if (text.length < COMMENT_MIN_LENGTH) {
    return `Comentário muito curto (mínimo ${COMMENT_MIN_LENGTH} caracteres)`;
  }

  if (text.length > COMMENT_MAX_LENGTH) {
    return `Comentário muito longo (máximo ${COMMENT_MAX_LENGTH} caracteres)`;
  }

  return null;
}
