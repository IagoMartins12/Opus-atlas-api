import {
  HealthCheckError,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

describe('indicadores de saúde', () => {
  describe('banco', () => {
    it('ping respondido é saudável, com o tempo', async () => {
      const prisma = { $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }) };
      const indicator = new PrismaHealthIndicator(
        prisma as unknown as PrismaService,
      );

      const result = await indicator.isHealthy('database');

      expect(prisma.$runCommandRaw).toHaveBeenCalledWith({ ping: 1 });
      expect(result.database).toMatchObject({
        status: 'up',
        responseTimeMs: expect.any(Number),
      });
    });

    it('falha vira HealthCheckError com o motivo', async () => {
      const prisma = {
        $runCommandRaw: jest.fn().mockRejectedValue(new Error('sem conexão')),
      };
      const indicator = new PrismaHealthIndicator(
        prisma as unknown as PrismaService,
      );

      const error = await indicator.isHealthy('database').catch((e) => e);
      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.causes.database).toMatchObject({
        status: 'down',
        message: 'sem conexão',
      });
    });
  });

  describe('cache', () => {
    it('grava e lê de volta o mesmo valor', async () => {
      const store = new Map<string, unknown>();
      const cache = {
        set: jest.fn((key: string, value: unknown) => {
          store.set(key, value);
          return Promise.resolve();
        }),
        get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      };
      const indicator = new RedisHealthIndicator(cache as unknown as Cache);

      await expect(indicator.isHealthy('cache')).resolves.toMatchObject({
        cache: { status: 'up' },
      });
    });

    // Redis fora costuma devolver `undefined` em silêncio: por isso a sonda lê de volta.
    it('valor que não volta é falha', async () => {
      const cache = {
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(undefined),
      };
      const indicator = new RedisHealthIndicator(cache as unknown as Cache);

      const error = await indicator.isHealthy('cache').catch((e) => e);
      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.causes.cache.message).toContain('não devolveu');
    });
  });
});

describe('HealthController', () => {
  it('vida só olha a memória; prontidão olha banco e cache', async () => {
    const health = {
      check: jest.fn((checks: Array<() => unknown>) =>
        Promise.all(checks.map((c) => c())),
      ),
    };
    const prisma = {
      isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };
    const redis = {
      isHealthy: jest.fn().mockResolvedValue({ cache: { status: 'up' } }),
    };
    const memory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
    };
    const controller = new HealthController(
      health as unknown as HealthCheckService,
      prisma as unknown as PrismaHealthIndicator,
      redis as unknown as RedisHealthIndicator,
      memory as unknown as MemoryHealthIndicator,
    );

    await controller.liveness();
    expect(memory.checkHeap).toHaveBeenCalledWith(
      'memory_heap',
      512 * 1024 * 1024,
    );
    expect(prisma.isHealthy).not.toHaveBeenCalled();

    await controller.readiness();
    expect(prisma.isHealthy).toHaveBeenCalledWith('database');
    expect(redis.isHealthy).toHaveBeenCalledWith('cache');
  });
});
