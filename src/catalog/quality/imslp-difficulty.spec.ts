import {
  parseDifficultyPage,
  summarize,
  tierOf,
  type DifficultyEntry,
} from './imslp-difficulty';

// Three rows as the page carries them: a whole work, an excerpt with
// `[pages, title]`, and one with only the file and `[from, to, pages, title]`.
const PAGE = `<script>f1t4779381034=${JSON.stringify({
  data: [
    [
      [5088, false, 10, 7],
      [5088, false, 1],
      [
        false,
        ['First Year Pieces (Dunhill, Thomas)', '633235'],
        'First Year Pieces',
        [
          [
            ['Type', 'Scores'],
            ['Comment', 'RCM (2008) Preparatory B'],
          ],
          '#ffa870',
        ],
        'Dunhill, Thomas',
        'Early 20th century',
      ],
      [[['633235', 'Complete Score', '1.74', '15', null]], false],
    ],
    [
      [105, false, 363, 567],
      [105, false, 6],
      [
        false,
        ['Guida di Musica, Op.37 (Hook, James)', '372029'],
        'Guida di Musica, Op.37',
        [[['Comment', 'RCM Preparatory B']], '#32a870'],
        'Hook, James',
        'Classical',
      ],
      [
        [
          [
            '372029',
            'Complete Score',
            '1.52',
            '26',
            ['p.8', 'Lesson 2: Tempo di minuetto'],
          ],
        ],
        false,
      ],
    ],
    [
      [159, false, 47, 34],
      [159, false, 3],
      [false, 465640, 'IMSLP #465640', [[['Comment', 'RCM 2']], '#a89b32']],
      [
        [
          [
            465640,
            'IMSLP #465640',
            null,
            null,
            [19, 19, 'p.19', '31. Dance in Canon Form'],
          ],
        ],
        false,
      ],
    ],
    [
      [6001, false, 1, 1],
      [6001, false, 12],
      [
        false,
        ['2 Arabesques, CD 74 (Debussy, Claude)', '1'],
        '2 Arabesques',
        [[], '#000'],
      ],
      [[['1', 'Complete', '1', '9', ['1. Première arabesque']]], false],
    ],
    ['linha quebrada'],
  ],
  jsfunc: 'diffmt',
  colids: ['updvote', 'lvl', 'work', 'files', 'diffvote', 'tbx'],
})};</script>`;

const entry = (over: Partial<DifficultyEntry>): DifficultyEntry => ({
  entryId: 1,
  instrument: 'Piano',
  level: 5,
  page: 'X',
  fileIds: [],
  excerpt: null,
  pages: null,
  reference: null,
  ...over,
});

describe('parseDifficultyPage', () => {
  const rows = parseDifficultyPage(PAGE, 'Piano');

  it('lê as entradas e pula a que está fora do formato', () => {
    expect(rows.map((r) => r.entryId)).toEqual([5088, 105, 159, 6001]);
  });

  it('obra inteira: página, nível, arquivo e referência', () => {
    expect(rows[0]).toEqual({
      entryId: 5088,
      instrument: 'Piano',
      level: 1,
      page: 'First Year Pieces (Dunhill, Thomas)',
      fileIds: ['633235'],
      excerpt: null,
      pages: null,
      reference: 'RCM (2008) Preparatory B',
    });
  });

  it('trecho nos dois formatos, e entrada só com o arquivo', () => {
    expect(rows[1]).toMatchObject({
      excerpt: 'Lesson 2: Tempo di minuetto',
      pages: 'p.8',
    });
    expect(rows[2]).toMatchObject({
      page: null,
      fileIds: ['465640'],
      excerpt: '31. Dance in Canon Form',
      pages: 'p.19',
    });
  });

  it('trecho só com o título, sem as páginas', () => {
    expect(rows[3]).toMatchObject({
      excerpt: '1. Première arabesque',
      pages: null,
      reference: null,
    });
  });

  it('página sem a lista não quebra', () => {
    expect(parseDifficultyPage('<html></html>', 'Piano')).toEqual([]);
  });
});

describe('rótulo do arquivo', () => {
  const comRotulo = (label: string) =>
    parseDifficultyPage(
      `f1t1=${JSON.stringify({
        data: [
          [
            [1, false, 0, 0],
            [1, false, 5],
            [false, ['X (Y, Z)', '9'], 'X', [[], '#000']],
            [[['9', label, '1', '1', null]], false],
          ],
        ],
        colids: ['lvl'],
      })};`,
      'Piano',
    )[0].excerpt;

  it('peça da obra conta como trecho', () => {
    expect(comRotulo('5. Seguidillas')).toBe('5. Seguidillas');
    expect(comRotulo('Part 2: Allegro')).toBe('Part 2: Allegro');
  });

  it('partitura completa e parte de instrumento são a obra inteira', () => {
    for (const label of [
      'Complete Score (reprint)',
      'Violin Part',
      'Horn (F)',
      'Double Bass solo',
      'IMSLP #465640',
    ])
      expect(comRotulo(label)).toBeNull();
  });
});

describe('tierOf', () => {
  it('segue os grupos do RCM', () => {
    expect([1, 5, 6, 9, 10, 12, 15].map(tierOf)).toEqual([
      'BEGINNER',
      'BEGINNER',
      'INTERMEDIATE',
      'INTERMEDIATE',
      'ADVANCED',
      'ADVANCED',
      'ADVANCED',
    ]);
  });
});

describe('summarize', () => {
  it('obra inteira vale antes dos trechos', () => {
    expect(
      summarize(
        [
          entry({ entryId: 1, level: 3, excerpt: '1. Melodie' }),
          entry({ entryId: 2, level: 8 }),
        ],
        'Piano',
      ),
    ).toEqual({
      tier: 'INTERMEDIATE',
      level: 8,
      rating: 'Lvl 8',
      entryId: 2,
    });
  });

  it('só trechos: o do meio, com a faixa no rótulo', () => {
    expect(
      summarize(
        [2, 7, 4].map((level, i) =>
          entry({ entryId: i + 1, level, excerpt: `${i + 1}.` }),
        ),
        'Piano',
      ),
    ).toMatchObject({ level: 4, rating: 'Lvl 2–7', tier: 'BEGINNER' });
  });

  it('só a lista do instrumento da obra conta', () => {
    expect(
      summarize(
        [
          entry({ entryId: 1, instrument: 'Piano', level: 11 }),
          entry({ entryId: 2, instrument: 'Violino', level: 6 }),
        ],
        'Violino',
      ),
    ).toMatchObject({ level: 6, entryId: 2 });
    // As Arabescas na lista de harpa não dão nível à obra de piano.
    expect(
      summarize([entry({ instrument: 'Harpa', level: 12 })], 'Piano'),
    ).toBeNull();
  });

  it('sem a lista do principal, vale a dos outros instrumentos da obra', () => {
    expect(
      summarize([entry({ level: 7 })], ['Violoncelo', 'Piano']),
    ).toMatchObject({ level: 7 });
    expect(
      summarize(
        [
          entry({ entryId: 1, level: 11 }),
          entry({ entryId: 2, instrument: 'Violoncelo', level: 7 }),
        ],
        ['Violoncelo', 'Piano'],
      ),
    ).toMatchObject({ entryId: 2 });
  });

  it('teclado e cravo usam a lista de piano', () => {
    for (const instrument of ['Teclado', 'Cravo', 'Clavicórdio'])
      expect(summarize([entry({ level: 4 })], instrument)).toMatchObject({
        level: 4,
      });
  });

  it('sem entrada, sem nível', () => {
    expect(summarize([], 'Piano')).toBeNull();
  });
});
