import { PROMINENCE_MAX, prominenceOf } from './work-prominence';

const nada = {
  downloads: 0,
  hasPopularName: false,
  hasFamousParts: false,
  people: 0,
  hasRecording: false,
  byFamousComposer: false,
};

describe('prominenceOf', () => {
  it('obra sem sinal nenhum vale zero', () => {
    expect(prominenceOf(nada)).toBe(0);
  });

  it('cada dez vezes mais downloads vale o mesmo degrau', () => {
    const cem = prominenceOf({ ...nada, downloads: 99 });
    const mil = prominenceOf({ ...nada, downloads: 999 });
    const dezMil = prominenceOf({ ...nada, downloads: 9999 });
    expect(cem).toBe(200);
    expect(mil - cem).toBe(dezMil - mil);
  });

  it('o Cânone de Pachelbel passa da cantata esquecida do mesmo compositor', () => {
    const canone = prominenceOf({
      ...nada,
      downloads: 1_583_318,
      hasPopularName: true,
    });
    const cantata = prominenceOf({ ...nada, downloads: 40 });
    expect(canone).toBeGreaterThan(cantata + 500);
  });

  it('nome popular sem partitura lida ainda fica à frente do desconhecido baixado', () => {
    const apelidada = prominenceOf({ ...nada, hasPopularName: true });
    const baixada = prominenceOf({ ...nada, downloads: 200 });
    expect(apelidada).toBeGreaterThan(baixada);
  });

  it('compositor famoso e gravação só desempatam', () => {
    const desempate = prominenceOf({
      ...nada,
      hasRecording: true,
      byFamousComposer: true,
    });
    expect(desempate).toBeLessThan(prominenceOf({ ...nada, downloads: 999 }));
    expect(desempate).toBeGreaterThan(0);
  });

  it('nunca passa do teto nem fica negativa', () => {
    expect(
      prominenceOf({
        downloads: 1e12,
        hasPopularName: true,
        hasFamousParts: true,
        people: 1e6,
        hasRecording: true,
        byFamousComposer: true,
      }),
    ).toBe(PROMINENCE_MAX);
    expect(prominenceOf({ ...nada, downloads: -5, people: -1 })).toBe(0);
  });
});
