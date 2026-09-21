import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';
import { MetricsService } from '../observability/metrics.service';
import { CACHE_INVALIDATED_EVENT } from './cache-keys';
import { AppCacheService } from './cache.service';

async function* scan(batches: Array<string | string[]>) {
  for (const batch of batches) yield batch;
}

describe('AppCacheService', () => {
  let store: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    store?: unknown;
  };
  let metrics: { recordCacheHit: jest.Mock; recordCacheMiss: jest.Mock };
  let events: { emit: jest.Mock };
  let service: AppCacheService;

  beforeEach(() => {
    store = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    metrics = { recordCacheHit: jest.fn(), recordCacheMiss: jest.fn() };
    events = { emit: jest.fn() };
    service = new AppCacheService(
      store as unknown as Cache,
      metrics as unknown as MetricsService,
      events as unknown as EventEmitter2,
    );
  });

  describe('leitura e escrita', () => {
    it('conta acerto e erro por rota, quando informada', async () => {
      store.get.mockResolvedValueOnce({ a: 1 }).mockResolvedValueOnce(null);

      await expect(service.get('works:x', '/works')).resolves.toEqual({ a: 1 });
      await expect(service.get('works:y', '/works')).resolves.toBeUndefined();
      await service.get('works:z');

      expect(metrics.recordCacheHit).toHaveBeenCalledWith('/works');
      expect(metrics.recordCacheMiss).toHaveBeenCalledTimes(1);
    });

    // Redis fora deixa a API lenta, não derrubada.
    it('falha do Redis vira miss na leitura e silêncio na escrita', async () => {
      store.get.mockRejectedValue(new Error('ECONNREFUSED'));
      store.set.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.get('k')).resolves.toBeUndefined();
      await expect(service.set('k', 1, 1000)).resolves.toBeUndefined();
    });
  });

  describe('invalidar um namespace', () => {
    it('apaga por SCAN (nunca KEYS), em lotes ou uma a uma', async () => {
      const client = {
        scanIterator: jest.fn(() => scan([['works:a', 'works:b'], 'works:c'])),
        del: jest.fn().mockResolvedValue(3),
      };
      store.store = { client };

      await expect(service.invalidateNamespace('works' as never)).resolves.toBe(
        3,
      );
      expect(client.scanIterator).toHaveBeenCalledWith({
        MATCH: 'works:*',
        COUNT: 200,
      });
      expect(client.del).toHaveBeenCalledWith([
        'works:a',
        'works:b',
        'works:c',
      ]);
    });

    it('nada no namespace, nada apagado', async () => {
      const client = { scanIterator: jest.fn(() => scan([])), del: jest.fn() };
      store.store = { client };

      await expect(service.invalidateNamespace('works' as never)).resolves.toBe(
        0,
      );
      expect(client.del).not.toHaveBeenCalled();
    });

    it('store sem SCAN fica só no TTL; erro no SCAN não derruba', async () => {
      await expect(service.invalidateNamespace('works' as never)).resolves.toBe(
        0,
      );

      store.store = {
        client: {
          scanIterator: jest.fn(() => {
            throw new Error('redis');
          }),
          del: jest.fn(),
        },
      };
      await expect(service.invalidateNamespace('works' as never)).resolves.toBe(
        0,
      );
    });
  });

  describe('aviso ao front', () => {
    it('invalidar vários namespaces avisa uma vez, com todos', async () => {
      await service.invalidateMany(['works', 'composers'] as never);

      expect(events.emit).toHaveBeenCalledWith(CACHE_INVALIDATED_EVENT, {
        namespaces: ['works', 'composers'],
      });
    });

    it('lista vazia não avisa', async () => {
      await service.invalidateMany([]);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('apagar uma chave avisa o namespace dela, mesmo se o Redis falhar', async () => {
      store.del.mockRejectedValue(new Error('redis'));

      await service.del('composers:detail:c1');

      expect(events.emit).toHaveBeenCalledWith(CACHE_INVALIDATED_EVENT, {
        namespaces: ['composers'],
      });
    });

    it('chave fora dos namespaces não avisa; sem barramento de eventos, não quebra', async () => {
      await service.del('imslp-scores:tried:w1');
      expect(events.emit).not.toHaveBeenCalled();

      const semEventos = new AppCacheService(
        store as unknown as Cache,
        metrics as unknown as MetricsService,
      );
      await expect(
        semEventos.invalidateMany(['works'] as never),
      ).resolves.toBeUndefined();
    });
  });
});
