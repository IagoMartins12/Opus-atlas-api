import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MetricsService } from '../observability/metrics.service';
import { AppCacheService } from './cache.service';
import { CACHE_INVALIDATED_EVENT, namespaceOfKey } from './cache-keys';

describe('namespaceOfKey', () => {
  it('reconhece o namespace, inclusive o composto', () => {
    expect(namespaceOfKey('works:detail:1')).toBe('works');
    expect(namespaceOfKey('blog:articles:detail:abc')).toBe('blog:articles');
    expect(namespaceOfKey('achievements:cooldown:1')).toBeNull();
  });
});

describe('AppCacheService — aviso de dado novo', () => {
  const make = () => {
    const events = { emit: jest.fn() };
    // Store sem SCAN: a limpeza no Redis não acontece, e o aviso tem de sair.
    const cache = { del: jest.fn(), store: {} } as unknown as Cache;
    const service = new AppCacheService(
      cache,
      {} as MetricsService,
      events as unknown as EventEmitter2,
    );
    return { service, events };
  };

  // O cache do Next é independente do da API.
  it('avisa mesmo quando o Redis não tinha nada a apagar', async () => {
    const { service, events } = make();

    await service.invalidateMany(['works', 'composers']);

    expect(events.emit).toHaveBeenCalledWith(CACHE_INVALIDATED_EVENT, {
      namespaces: ['works', 'composers'],
    });
  });

  it('apagar uma chave avisa o namespace dela', async () => {
    const { service, events } = make();

    await service.del('works:detail:1');

    expect(events.emit).toHaveBeenCalledWith(CACHE_INVALIDATED_EVENT, {
      namespaces: ['works'],
    });
  });
});
