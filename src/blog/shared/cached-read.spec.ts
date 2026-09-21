import { AppCacheService } from '../../common/cache/cache.service';
import { cachedRead, cacheKey } from './cached-read';

describe('cacheKey', () => {
  // A invalidação procura `<namespace>:*`.
  it('começa pelo namespace', () => {
    expect(cacheKey('blog:articles', 'list', { page: 1 })).toMatch(
      /^blog:articles:list:/,
    );
  });

  it('a mesma consulta dá a mesma chave em qualquer ordem', () => {
    expect(
      cacheKey('blog:articles', 'list', { page: 1, sortBy: 'newest' }),
    ).toBe(cacheKey('blog:articles', 'list', { sortBy: 'newest', page: 1 }));
  });

  it('parâmetro ausente não muda a chave', () => {
    expect(
      cacheKey('blog:tags', 'list', { limit: 50, search: undefined }),
    ).toBe(cacheKey('blog:tags', 'list', { limit: 50 }));
  });

  it('consultas diferentes dão chaves diferentes', () => {
    expect(cacheKey('blog:articles', 'list', { page: 1 })).not.toBe(
      cacheKey('blog:articles', 'list', { page: 2 }),
    );
  });

  it('sem parâmetros, é o namespace e o tipo', () => {
    expect(cacheKey('blog:articles', 'featured')).toBe(
      'blog:articles:featured',
    );
  });
});

describe('cachedRead', () => {
  const make = (stored?: unknown) => ({
    get: jest.fn().mockResolvedValue(stored),
    set: jest.fn().mockResolvedValue(undefined),
  });

  it('acerto não carrega', async () => {
    const cache = make({ ok: true });
    const load = jest.fn();

    await expect(
      cachedRead(cache as unknown as AppCacheService, 'k', 1000, 'r', load),
    ).resolves.toEqual({ ok: true });
    expect(load).not.toHaveBeenCalled();
  });

  it('falta carrega e guarda', async () => {
    const cache = make(undefined);

    await cachedRead(
      cache as unknown as AppCacheService,
      'k',
      1000,
      'r',
      async () => ({ ok: 1 }),
    );

    expect(cache.set).toHaveBeenCalledWith('k', { ok: 1 }, 1000);
  });
});
