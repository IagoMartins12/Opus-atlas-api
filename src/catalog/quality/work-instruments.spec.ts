import {
  classifyBassWork,
  instrumentMove,
  instrumentsFromFicha,
  isFluteNotRecorder,
  workInstruments,
} from './work-instruments';

const NAMES = [
  'Orquestra',
  'Tenor',
  'Tímpanos',
  'Flautim',
  'Cordas',
  'Fagote',
  'Contrabaixo',
  'Voz',
  'Soprano',
  'Coro',
  'Piano',
  'Flauta Doce',
  'Baixo Contínuo',
];

describe('classifyBassWork', () => {
  const classify = (
    title: string,
    instrumentation: string | null,
    fromTitle: string | null = null,
  ) => classifyBassWork({ title, instrumentation }, NAMES, fromTitle);

  it('contrabaixo de verdade fica', () => {
    expect(
      classify('Andante for Double Bass, Op.186', 'Contrabaixo, Piano'),
    ).toEqual({ action: 'keep' });
    expect(classify('Sonata', 'Contrabaixo', 'Contrabaixo')).toEqual({
      action: 'keep',
    });
  });

  it('o instrumento do título vence', () => {
    expect(
      classify(
        'Bassoon Concerto in C major',
        'Fagote, Orquestra Cordas',
        'Fagote',
      ),
    ).toEqual({ action: 'move', to: 'Fagote' });
  });

  it('flauta no título vai para flauta, mesmo antes de ela existir', () => {
    expect(classify('Flute Concerto', 'Flauta, Orquestra', 'Flauta')).toEqual({
      action: 'move',
      to: 'Flauta',
    });
  });

  it('"Solo" no título não é instrumento', () => {
    expect(classify('Grand Solo No.2', 'Contrabaixo', 'Solo')).toEqual({
      action: 'unknown',
    });
  });

  it('sinfonia é orquestra, ainda que cite seção', () => {
    expect(
      classify(
        'Symphony in C major',
        'Orquestra Flautim, Oboes, Tímpanos, Cordas',
      ),
    ).toEqual({ action: 'move', to: 'Orquestra' });
  });

  it('coro vence voz e instrumento solto', () => {
    expect(classify('Lieder', 'Soprano, Coro, Piano')).toEqual({
      action: 'move',
      to: 'Coro',
    });
  });

  it('só voz: a primeira citada', () => {
    expect(classify('A Star Song', 'Tenor, Soprano')).toEqual({
      action: 'move',
      to: 'Tenor',
    });
  });

  it('o primeiro instrumento citado, no mesmo ponto o nome mais longo', () => {
    expect(classify('X', 'Flauta Doce, Baixo Contínuo')).toEqual({
      action: 'move',
      to: 'Flauta Doce',
    });
  });

  it('só "Contrabaixo" na instrumentação, sem pista: não se sabe', () => {
    expect(classify('2 Solos', 'Contrabaixo')).toEqual({ action: 'unknown' });
  });
});

describe('isFluteNotRecorder', () => {
  it('flauta transversal', () => {
    expect(
      isFluteNotRecorder({
        title: 'Flute Concerto No.1',
        instrumentation: 'Flauta, Orquestra',
      }),
    ).toBe(true);
  });
  it('flauta doce continua sendo flauta doce', () => {
    expect(
      isFluteNotRecorder({
        title: 'Recorder Sonata',
        instrumentation: 'Flauta Doce, Baixo Contínuo',
      }),
    ).toBe(false);
    expect(
      isFluteNotRecorder({
        title: 'Sonata for Flute and Recorder',
        instrumentation: null,
      }),
    ).toBe(false);
  });
  it('sem pista, não mexe', () => {
    expect(
      isFluteNotRecorder({ title: 'Miniature', instrumentation: 'Oboé' }),
    ).toBe(false);
  });
});

describe('instrumentsFromFicha', () => {
  it.each([
    ['Órgão', 'Órgão'],
    ['Piano Solo', 'Piano'],
    ['Piano 4-mãos', 'Piano'],
    ['Vozes satb', 'Voz'],
    ['Trumpets', 'Trompete'],
    ['Voz, Piano', 'Voz'],
    ['Violoncelo, Piano', 'Violoncelo'],
    ['Trompa, Orquestra', 'Trompa'],
    ['Soprano, Baixo Contínuo', 'Soprano'],
    ['Mixed Coro satb, Órgão', 'Coro'],
    ['Voz, Mixed Coro satb, Piano', 'Coro'],
  ])('%s → %s', (ficha, instrument) => {
    expect(instrumentsFromFicha(ficha)[0]).toBe(instrument);
  });

  it('todas as alternativas contam', () => {
    expect(instrumentsFromFicha('Órgão ou Harmônio')).toEqual([
      'Órgão',
      'Harmônio',
    ]);
    expect(
      instrumentsFromFicha('Voz, Orquestra de Câmara original ; Voz, Piano'),
    ).toEqual(['Voz']);
  });

  it('combinação maior não decide', () => {
    for (const ficha of [
      'Violino, Violoncelo, Piano',
      'Vozes, Coro, Orquestra',
      'Instruments',
      '',
      null,
    ])
      expect(instrumentsFromFicha(ficha)).toEqual([]);
  });
});

describe('instrumentMove', () => {
  const ficha = (instrumentation: string, title = 'Obra') => ({
    title,
    instrumentation,
  });

  it('corrige o que a ficha desmente', () => {
    expect(instrumentMove(ficha('Órgão'), 'Quarteto')).toBe('Órgão');
    expect(instrumentMove(ficha('Cravo'), 'Harpa')).toBe('Cravo');
    expect(instrumentMove(ficha('Trompete'), 'Trompa')).toBe('Trompete');
  });

  it('mantém o que a ficha aceita, e o que ela não decide', () => {
    expect(instrumentMove(ficha('Órgão ou Harmônio'), 'Harmônio')).toBeNull();
    expect(
      instrumentMove(ficha('Violino, Violoncelo, Piano'), 'Piano'),
    ).toBeNull();
    expect(instrumentMove(ficha('Coro, Orquestra'), 'Orquestra')).toBeNull();
  });

  it('contrabaixo só com o título confirmando', () => {
    expect(
      instrumentMove(ficha('Contrabaixo, Piano', 'Songs for Bass'), 'Piano'),
    ).toBeNull();
    expect(
      instrumentMove(
        ficha('Contrabaixo, Piano', 'Double Bass Sonata'),
        'Piano',
      ),
    ).toBe('Contrabaixo');
  });
});

describe('workInstruments', () => {
  const de = (instrumentation: string | null, main: string | null) =>
    workInstruments({ title: 'Obra', instrumentation }, main);

  it('a canção é de voz e de piano, o principal primeiro', () => {
    expect(de('Voz, Piano', 'Voz')).toEqual(['Voz', 'Piano']);
  });

  it('combinação maior também conta', () => {
    expect(de('Violino, Violoncelo, Piano', 'Violino')).toEqual([
      'Violino',
      'Violoncelo',
      'Piano',
    ]);
    expect(de('Mixed Coro satb, Órgão ou Harmônio', 'Coro')).toEqual([
      'Coro',
      'Órgão',
      'Harmônio',
    ]);
  });

  it('baixo contínuo não é instrumento, e sem ficha fica o principal', () => {
    expect(de('Soprano, Baixo Contínuo', 'Soprano')).toEqual(['Soprano']);
    expect(de(null, 'Piano')).toEqual(['Piano']);
  });

  it('obra de teclado também é de piano; cravo, não', () => {
    expect(de('Teclado', 'Teclado')).toEqual(['Teclado', 'Piano']);
    expect(de('Cravo', 'Cravo')).toEqual(['Cravo']);
  });

  it('"Bass" só é contrabaixo com o título confirmando', () => {
    expect(de('Contrabaixo, Piano', 'Voz')).toEqual(['Voz', 'Piano']);
  });
});
