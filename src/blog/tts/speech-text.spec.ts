import { articleSpeechText, splitForSpeech } from './speech-text';

describe('articleSpeechText', () => {
  const doc = (...content: unknown[]) => ({ type: 'doc', content });
  const p = (text: string) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });

  it('lê título, resumo e texto, com pausa entre os blocos', () => {
    expect(
      articleSpeechText({
        title: 'Chopin',
        description: 'Um retrato',
        content: doc(
          { type: 'heading', content: [{ type: 'text', text: 'Infância' }] },
          p('Nasceu em 1810'),
        ),
      }),
    ).toBe('Chopin. Um retrato. Infância. Nasceu em 1810.');
  });

  it('não repete pontuação que o texto já tem', () => {
    expect(
      articleSpeechText({
        title: 'Quem foi?',
        description: null,
        content: doc(p('Foi Chopin!')),
      }),
    ).toBe('Quem foi? Foi Chopin!');
  });

  it('lê a citação musical com o autor, e pula código', () => {
    expect(
      articleSpeechText({
        title: 'T',
        description: null,
        content: doc(
          {
            type: 'quoteMusical',
            attrs: { quote: 'A música é o silêncio', author: 'Debussy' },
          },
          {
            type: 'codeBlock',
            content: [{ type: 'text', text: 'const x = 1' }],
          },
        ),
      }),
    ).toBe('T. A música é o silêncio — Debussy.');
  });
});

describe('splitForSpeech', () => {
  it('texto curto é um pedaço só', () => {
    expect(splitForSpeech('Uma frase. Outra frase.')).toEqual([
      'Uma frase. Outra frase.',
    ]);
  });

  // O legado cortava por caractere; o limite do Google é em byte.
  it('conta bytes, não caracteres — acento ocupa dois', () => {
    const accented = 'Ópera à noção ação. '.repeat(300);
    const chunks = splitForSpeech(accented, 4500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(4500);
    }
  });

  it('frase maior que o limite é quebrada por palavra', () => {
    const chunks = splitForSpeech(`${'palavra '.repeat(40)}fim.`, 60);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(60);
    }
  });

  it('não perde texto ao dividir', () => {
    const text = 'Primeira frase. Segunda frase! Terceira?';
    expect(splitForSpeech(text, 20).join(' ')).toBe(text);
  });
});
