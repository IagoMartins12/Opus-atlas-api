import { EventType } from '@prisma/client';
import {
  createSlug,
  extractDateTime,
  normalizeText,
  parseDatePortuguese,
  parseTime,
} from './date-parser';
import {
  cleanHtml,
  detectEventType,
  extractComposerNames,
  extractFirstParagraph,
} from './text-cleaner';

describe('date-parser', () => {
  it('lê data por extenso em português', () => {
    expect(parseDatePortuguese('qua., 5 de novembro de 2025')).toEqual(
      new Date(2025, 10, 5),
    );
    expect(parseDatePortuguese('7 de Dezembro de 2025, 20h30')).toEqual(
      new Date(2025, 11, 7),
    );
  });

  it('mês desconhecido ou formato fora do padrão é null', () => {
    expect(parseDatePortuguese('5 de brumário de 2025')).toBeNull();
    expect(parseDatePortuguese('2025-11-05')).toBeNull();
  });

  it('hora com e sem minutos', () => {
    expect(parseTime('às 20h30')).toBe('20:30');
    expect(parseTime('9h')).toBe('09:00');
    expect(parseTime('noite')).toBeNull();
  });

  it('normaliza, faz slug e extrai data e hora juntas', () => {
    expect(normalizeText('  Ópera Nª 1 ')).toBe('opera nª 1');
    expect(createSlug('Concerto de Natal — OSESP!!')).toBe(
      'concerto-de-natal-osesp',
    );
    expect(extractDateTime('sáb., 7 de dezembro de 2025, 20h30')).toEqual({
      date: new Date(2025, 11, 7),
      time: '20:30',
    });
  });

  it('entrada que não é texto não derruba: devolve null', () => {
    expect(parseDatePortuguese(undefined as unknown as string)).toBeNull();
    expect(parseTime(undefined as unknown as string)).toBeNull();
  });
});

describe('text-cleaner', () => {
  it('tira tags e entidades HTML', () => {
    expect(
      cleanHtml(
        '<p>Bach &amp; Händel&nbsp;&lt;3&gt; &quot;x&quot; &#39;y&#39;</p>',
      ),
    ).toBe(`Bach & Händel <3> "x" 'y'`);
  });

  it('primeiro parágrafo com conteúdo, ou o começo do texto', () => {
    const long =
      'Um parágrafo com conteúdo de verdade e mais de cinquenta caracteres.';
    expect(extractFirstParagraph(`curto\n${long}`)).toBe(long);
    expect(extractFirstParagraph('curto')).toBe('curto');
  });

  it.each([
    ['Wozzeck', '', EventType.OPERA],
    ['Recital de piano', '', EventType.RECITAL],
    ['Ensaio aberto', '', EventType.OPEN_REHEARSAL],
    ['Coro da OSESP', '', EventType.CHOIR],
    ['Câmara: quarteto', '', EventType.CHAMBER_MUSIC],
    ['Matinais: Brahms', '', EventType.CONCERT],
    ['OSESP Duas e Trinta', '', EventType.CONCERT],
    ['Concerto', 'Mahler', EventType.CONCERT],
  ])('"%s" é %s', (title, description, type) => {
    expect(detectEventType(title, description)).toBe(type);
  });

  it('acha compositores pelos padrões de programa de concerto', () => {
    expect(
      extractComposerNames(
        'Beethoven Sinfonia nº 5\nobra de Alban Berg\nPIOTR ILITCH TCHAIKOVSKY',
      ),
    ).toEqual(['Beethoven', 'Tchaikovsky', 'Berg']);
  });

  // "Wagner Polistchuk" é diretor musical, não o compositor.
  it('nome da lista de exclusão não conta', () => {
    expect(extractComposerNames('por Wagner Polistchuk')).not.toContain(
      'Wagner',
    );
  });
});
