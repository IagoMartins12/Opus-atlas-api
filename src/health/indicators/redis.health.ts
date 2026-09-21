import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { errorMessage } from '../../common/utils/error.util';

const PROBE_KEY = 'health:probe';

/**
 * Verifica o cache distribuído fazendo um round-trip real de escrita e leitura.
 *
 * Um simples `get` não serve: com o Redis fora, várias implementações de store
 * devolvem `undefined` em silêncio, o que é indistinguível de "chave ausente".
 * Escrever e ler de volta é o que prova que a instância está de fato acessível.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();
    const token = `${process.pid}:${Date.now()}`;

    try {
      await this.cache.set(PROBE_KEY, token, 5_000);
      const readBack = await this.cache.get<string>(PROBE_KEY);

      if (readBack !== token) {
        throw new Error('Cache não devolveu o valor gravado na sonda');
      }

      return this.getStatus(key, true, { responseTimeMs: Date.now() - start });
    } catch (error: unknown) {
      throw new HealthCheckError(
        'Cache indisponível',
        this.getStatus(key, false, { message: errorMessage(error) }),
      );
    }
  }
}
