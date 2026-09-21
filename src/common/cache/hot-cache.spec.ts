import { HotCache } from './hot-cache';

describe('HotCache', () => {
  it('devolve o que guardou e esquece quando o TTL vence', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T00:00:00Z'));
    const cache = new HotCache({ maxEntries: 10 });

    cache.set('works:a', { total: 1 }, 10_000);
    expect(cache.get('works:a')).toEqual({ total: 1 });

    jest.advanceTimersByTime(10_001);
    expect(cache.get('works:a')).toBeUndefined();
    expect(cache.size).toBe(0);

    jest.useRealTimers();
  });

  it('TTL zero ou negativo não guarda nada', () => {
    const cache = new HotCache({ maxEntries: 10 });

    cache.set('works:a', 1, 0);
    cache.set('works:b', 1, -5);

    expect(cache.size).toBe(0);
  });

  // O teto existe para o L1 não virar um segundo cache a ser dimensionado.
  it('evicta o menos usado quando passa do teto', () => {
    const cache = new HotCache({ maxEntries: 2 });

    cache.set('a', 1, 10_000);
    cache.set('b', 2, 10_000);
    // Acessar 'a' o torna o mais recente: quem sai é 'b'.
    cache.get('a');
    cache.set('c', 3, 10_000);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('limpa por prefixo — é assim que a invalidação por domínio chega ao L1', () => {
    const cache = new HotCache({ maxEntries: 10 });

    cache.set('works:catalog:1', 1, 10_000);
    cache.set('works:detail:x', 2, 10_000);
    cache.set('composers:detail:y', 3, 10_000);

    expect(cache.deleteByPrefix('works:')).toBe(2);
    expect(cache.get('works:catalog:1')).toBeUndefined();
    expect(cache.get('composers:detail:y')).toBe(3);
  });
});
