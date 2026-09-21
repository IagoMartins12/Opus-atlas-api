import { Cache } from 'cache-manager';
import { MetricsService } from '../observability/metrics.service';
import { AppCacheService } from './cache.service';

const metrics = () =>
  ({
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
  }) as unknown as MetricsService;

describe('AppCacheService.remember', () => {
  const make = (store: Map<string, unknown> = new Map()) => {
    const cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
      store: {},
    } as unknown as Cache;

    return { cache, store, service: new AppCacheService(cache, metrics()) };
  };

  it('calcula no miss, grava e reaproveita na chamada seguinte', async () => {
    const { service, cache } = make();
    const load = jest.fn().mockResolvedValue({ works: [] });

    await expect(
      service.remember('works:catalog:1', { ttlMs: 1000 }, load),
    ).resolves.toEqual({ works: [] });
    await expect(
      service.remember('works:catalog:1', { ttlMs: 1000 }, load),
    ).resolves.toEqual({ works: [] });

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'works:catalog:1',
      { works: [] },
      1000,
    );
  });

  /**
   * O defeito que derrubou o processo no teste de carga: N requisições que
   * erram a mesma chave ao mesmo tempo disparavam N consultas idênticas.
   */
  it('vinte chamadas simultâneas na mesma chave fazem um cálculo só', async () => {
    const { service } = make();
    let resolveLoad!: (value: number) => void;
    const pending = new Promise<number>((resolve) => {
      resolveLoad = resolve;
    });
    const load = jest.fn(() => pending);

    const calls = Array.from({ length: 20 }, () =>
      service.remember('works:catalog:2', { ttlMs: 1000 }, load),
    );
    // As vinte ainda estão no `await` da leitura do Redis; só depois dele uma
    // delas assume o cálculo e as outras entram na fila dela.
    await new Promise((resolve) => setImmediate(resolve));
    resolveLoad(42);

    await expect(Promise.all(calls)).resolves.toEqual(
      Array.from({ length: 20 }, () => 42),
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falha no cálculo chega a quem esperava e não fica presa', async () => {
    const { service } = make();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('banco fora'))
      .mockResolvedValueOnce('ok');

    await expect(
      service.remember('works:catalog:3', { ttlMs: 1000 }, load),
    ).rejects.toThrow('banco fora');
    // A chave não fica marcada como "em cálculo" depois do erro.
    await expect(
      service.remember('works:catalog:3', { ttlMs: 1000 }, load),
    ).resolves.toBe('ok');
  });

  it('com hotTtlMs a segunda leitura não vai ao Redis', async () => {
    const { service, cache } = make();
    const load = jest.fn().mockResolvedValue('v');

    await service.remember(
      'works:catalog:4',
      { ttlMs: 1000, hotTtlMs: 10_000 },
      load,
    );
    (cache.get as jest.Mock).mockClear();

    await expect(
      service.remember(
        'works:catalog:4',
        { ttlMs: 1000, hotTtlMs: 10_000 },
        load,
      ),
    ).resolves.toBe('v');
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('invalidar o namespace também derruba o L1 desta réplica', async () => {
    const { service, cache } = make();
    const load = jest
      .fn()
      .mockResolvedValueOnce('antigo')
      .mockResolvedValueOnce('novo');

    await service.remember(
      'works:catalog:5',
      { ttlMs: 1000, hotTtlMs: 10_000 },
      load,
    );
    await service.invalidateNamespace('works');
    (cache.get as jest.Mock).mockResolvedValue(undefined);

    await expect(
      service.remember(
        'works:catalog:5',
        { ttlMs: 1000, hotTtlMs: 10_000 },
        load,
      ),
    ).resolves.toBe('novo');
  });

  it('apagar uma chave também a tira do L1', async () => {
    const { service, cache } = make();
    const load = jest
      .fn()
      .mockResolvedValueOnce('antigo')
      .mockResolvedValueOnce('novo');

    await service.remember(
      'works:detail:6',
      { ttlMs: 1000, hotTtlMs: 10_000 },
      load,
    );
    await service.del('works:detail:6');
    (cache.get as jest.Mock).mockResolvedValue(undefined);

    await expect(
      service.remember(
        'works:detail:6',
        { ttlMs: 1000, hotTtlMs: 10_000 },
        load,
      ),
    ).resolves.toBe('novo');
  });
});
