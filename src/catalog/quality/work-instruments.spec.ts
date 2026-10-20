import { classifyBassWork, isFluteNotRecorder } from './work-instruments';

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
