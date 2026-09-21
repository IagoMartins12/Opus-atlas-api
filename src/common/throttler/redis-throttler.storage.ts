import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

interface StoredHits {
  hits: number;
  /** Epoch em ms do fim da janela corrente. */
  expiresAt: number;
}

/**
 * Armazenamento de rate limit compartilhado entre instâncias.
 *
 * O storage padrão do `@nestjs/throttler` é um `Map` em memória do processo.
 * Com N réplicas atrás de um balanceador, cada uma conta separado e o limite
 * efetivo vira `N × limite` — ou seja, o rate limit deixa de valer exatamente
 * quando a API escala horizontalmente, que é quando ele mais importa.
 *
 * Esta implementação guarda a contagem no mesmo Redis já usado como cache, o
 * que torna o limite global ao cluster. Usa o `CACHE_MANAGER` existente em vez
 * de abrir uma segunda conexão, então segue qualquer store que for configurado.
 *
 * Observação sobre concorrência: `cache-manager` não expõe `INCR` atômico, e
 * duas requisições simultâneas na mesma chave podem perder uma contagem. Para
 * limitação de abuso isso é aceitável (o erro é de no máximo algumas unidades
 * por janela); se um dia o limite precisar ser exato, o caminho é trocar por
 * um `INCR` + `EXPIRE` direto no cliente Redis.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const cacheKey = `throttle:${key}`;
    const now = Date.now();

    try {
      const current = await this.cache.get<StoredHits>(cacheKey);

      if (current && current.expiresAt > now) {
        const updated: StoredHits = {
          hits: current.hits + 1,
          expiresAt: current.expiresAt,
        };

        await this.cache.set(cacheKey, updated, updated.expiresAt - now);

        return {
          totalHits: updated.hits,
          timeToExpire: Math.ceil((updated.expiresAt - now) / 1000),
        };
      }

      // Janela nova (primeira requisição, ou a anterior já expirou).
      const fresh: StoredHits = { hits: 1, expiresAt: now + ttl };
      await this.cache.set(cacheKey, fresh, ttl);

      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000) };
    } catch (error) {
      // Cache fora do ar não pode derrubar a API inteira. Deixa passar e
      // registra — disponibilidade vale mais que a precisão do limite aqui.
      this.logger.error(
        `Falha ao contabilizar rate limit para "${key}" — requisição liberada`,
        error instanceof Error ? error.stack : String(error),
      );

      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000) };
    }
  }
}
