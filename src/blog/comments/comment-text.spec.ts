import {
  COMMENT_MAX_LENGTH,
  commentLengthError,
  normalizeCommentText,
} from './comment-text';

describe('normalizeCommentText', () => {
  // Texto puro exibido pelo React: escapar aqui seria escapar duas vezes.
  it('não escapa marcação — "a < b" continua "a < b"', () => {
    expect(normalizeCommentText('a < b && <b>x</b>')).toBe('a < b && <b>x</b>');
  });

  it('unifica quebras de linha', () => {
    expect(normalizeCommentText('um\r\ndois\rtrês')).toBe('um\ndois\ntrês');
  });

  it('tira caracteres de controle, mantendo quebra e tabulação', () => {
    expect(normalizeCommentText('a\u0000b\u0007c\td\ne')).toBe('abc\td\ne');
  });

  // Com U+202E, um texto aparece na tela e outro é o que está gravado.
  it('tira os caracteres de direção bidirecional', () => {
    expect(normalizeCommentText('visite \u202Emoc.elpmaxe\u202C')).toBe(
      'visite moc.elpmaxe',
    );
    expect(normalizeCommentText('a\u2066b\u2069c')).toBe('abc');
  });

  it('limita linhas em branco seguidas a duas', () => {
    expect(normalizeCommentText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('apara as pontas', () => {
    expect(normalizeCommentText('  \n olá \n ')).toBe('olá');
  });
});

describe('commentLengthError', () => {
  it('curto demais', () => {
    expect(commentLengthError('ok')).toMatch(/curto/);
  });

  it('longo demais', () => {
    expect(commentLengthError('x'.repeat(COMMENT_MAX_LENGTH + 1))).toMatch(
      /longo/,
    );
  });

  it('no tamanho', () => {
    expect(commentLengthError('Belo texto sobre Chopin')).toBeNull();
  });
});
