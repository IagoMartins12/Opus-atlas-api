import { clampReadSeconds, MAX_READ_SECONDS, nextAverage } from './read-time';

describe('clampReadSeconds', () => {
  it('leitura dentro do esperado conta inteira', () => {
    expect(clampReadSeconds(420, 8)).toBe(420);
  });

  // Quem fica o triplo do tempo deixou a aba aberta.
  it('limita a três vezes o tempo estimado', () => {
    expect(clampReadSeconds(10 * 60 * 60, 8)).toBe(8 * 60 * 3);
  });

  it('sem estimativa, limita a quatro horas', () => {
    expect(clampReadSeconds(10 * 60 * 60, null)).toBe(MAX_READ_SECONDS);
  });

  it('artigo curtíssimo ainda aceita um minuto', () => {
    expect(clampReadSeconds(50, 0.1)).toBe(50);
  });

  it('nunca conta menos de um segundo', () => {
    expect(clampReadSeconds(0.2, 8)).toBe(1);
  });
});

describe('nextAverage', () => {
  it('primeira leitura é a própria média', () => {
    expect(nextAverage(null, 0, 300)).toBe(300);
  });

  it('soma à média existente', () => {
    expect(nextAverage(300, 1, 500)).toBe(400);
  });
});
