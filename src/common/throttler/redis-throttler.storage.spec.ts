import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    cache = { get: jest.fn(), set: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisThrottlerStorage,
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    storage = module.get(RedisThrottlerStorage);
  });

  it('começa a janela em 1 acerto quando não há registro', async () => {
    cache.get.mockResolvedValue(undefined);

    const result = await storage.increment('ip:1.2.3.4', 60_000);

    expect(result.totalHits).toBe(1);
    expect(result.timeToExpire).toBe(60);
  });

  it('acumula acertos dentro da mesma janela', async () => {
    cache.get.mockResolvedValue({ hits: 4, expiresAt: Date.now() + 30_000 });

    const result = await storage.increment('ip:1.2.3.4', 60_000);

    expect(result.totalHits).toBe(5);
  });

  // Esta é a razão de existir do storage: com o Map em memória do throttler
  // padrão, cada réplica conta separado e o limite vira `réplicas × limite`.
  it('grava a contagem no cache compartilhado, não em memória local', async () => {
    cache.get.mockResolvedValue(undefined);

    await storage.increment('ip:1.2.3.4', 60_000);

    expect(cache.set).toHaveBeenCalledWith(
      'throttle:ip:1.2.3.4',
      expect.objectContaining({ hits: 1 }),
      60_000,
    );
  });

  it('reinicia a contagem quando a janela anterior já expirou', async () => {
    cache.get.mockResolvedValue({ hits: 99, expiresAt: Date.now() - 1_000 });

    const result = await storage.increment('ip:1.2.3.4', 60_000);

    expect(result.totalHits).toBe(1);
  });

  it('preserva o fim da janela ao incrementar, sem estendê-la', async () => {
    const expiresAt = Date.now() + 20_000;
    cache.get.mockResolvedValue({ hits: 2, expiresAt });

    await storage.increment('ip:1.2.3.4', 60_000);

    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ expiresAt }),
      expect.any(Number),
    );
  });

  // Redis fora do ar deve tornar a API mais permissiva, nunca indisponível.
  it('libera a requisição quando o cache falha', async () => {
    cache.get.mockRejectedValue(new Error('conexão recusada'));

    const result = await storage.increment('ip:1.2.3.4', 60_000);

    expect(result.totalHits).toBe(1);
  });

  it('isola chaves de usuários diferentes', async () => {
    cache.get.mockResolvedValue(undefined);

    await storage.increment('user:abc', 60_000);

    expect(cache.set).toHaveBeenCalledWith(
      'throttle:user:abc',
      expect.anything(),
      expect.any(Number),
    );
  });
});
