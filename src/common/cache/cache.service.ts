import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { MetricsService } from '../observability/metrics.service';
import { errorMessage } from '../utils/error.util';
import {
  CACHE_INVALIDATED_EVENT,
  CacheInvalidatedEvent,
  CacheNamespaceValue,
  namespaceOfKey,
} from './cache-keys';
import { HotCache } from './hot-cache';

/**
 * Teto do L1. Cada entrada é uma resposta de listagem já serializada; 500
 * cobre com folga as páginas e combinações de filtro que concentram o tráfego
 * anônimo, sem virar um segundo cache a ser dimensionado.
 */
const HOT_CACHE_MAX_ENTRIES = 500;

/** Store do cache-manager que expõe o cliente Redis por baixo. */
interface RedisBackedStore {
  client?: {
    scanIterator?: (options: {
      MATCH: string;
      COUNT: number;
    }) => AsyncIterable<string | string[]>;
    del?: (keys: string | string[]) => Promise<number>;
  };
}

/**
 * Camada de cache da aplicação, com três coisas que o `CACHE_MANAGER` cru não
 * oferece e que a SPEC §3.7 pede:
 *
 * 1. **Invalidação por namespace.** As chaves do catálogo embutem a assinatura
 *    dos filtros, então são impossíveis de enumerar na mão. Aqui a invalidação
 *    é por prefixo, via `SCAN` no Redis — nunca `KEYS`, que bloqueia o servidor
 *    inteiro enquanto varre.
 * 2. **Métrica de hit/miss por rota**, que alimenta o painel de cache.
 * 3. **Degradação segura.** Falha de cache vira log e um miss, nunca um 500:
 *    Redis fora deve deixar a API lenta, não derrubada.
 * 4. **Leitura com `remember`**, que junta três coisas que estavam repetidas em
 *    cada service — ler, calcular no miss e gravar — e acrescenta duas que
 *    faltavam: a camada L1 no processo (ver `HotCache`) e o *single-flight*.
 * 5. **Single-flight.** Sem ele, N requisições que erram a mesma chave ao mesmo
 *    tempo disparam N consultas idênticas. Foi assim que o processo caiu no
 *    teste de carga: 20 requisições simultâneas viraram 20 varreduras de 207
 *    mil obras, o pool do Prisma encheu e as consultas rápidas morreram na
 *    fila. Aqui a primeira calcula e as outras esperam o mesmo resultado.
 */
@Injectable()
export class AppCacheService {
  private readonly logger = new Logger(AppCacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly metrics: MetricsService,
    // Opcional para os testes que montam o serviço sem o módulo de eventos.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** L1 do processo. Pequeno de propósito: só o que é quente e público. */
  private readonly hot = new HotCache({ maxEntries: HOT_CACHE_MAX_ENTRIES });

  /** Cálculos em andamento, por chave — a base do single-flight. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Lê do cache; no miss, calcula uma vez só e grava.
   *
   * `hotTtlMs` liga a camada L1 para aquela chave. Usar **apenas** em resposta
   * pública e idêntica para todo visitante: o L1 é por réplica e não recebe a
   * invalidação disparada em outra (ver `HotCache`).
   */
  async remember<T>(
    key: string,
    options: {
      ttlMs: number;
      hotTtlMs?: number;
      metricRoute?: string;
    },
    load: () => Promise<T>,
  ): Promise<T> {
    const { ttlMs, hotTtlMs = 0, metricRoute } = options;

    if (hotTtlMs > 0) {
      const local = this.hot.get<T>(key);
      if (local !== undefined) {
        if (metricRoute) this.metrics.recordCacheHit(metricRoute);
        return local;
      }
    }

    const cached = await this.get<T>(key, metricRoute);
    if (cached !== undefined) {
      if (hotTtlMs > 0) this.hot.set(key, cached, hotTtlMs);
      return cached;
    }

    const running = this.inFlight.get(key);
    if (running) {
      return running as Promise<T>;
    }

    const computation = load()
      .then(async (value) => {
        await this.set(key, value, ttlMs);
        if (hotTtlMs > 0) this.hot.set(key, value, hotTtlMs);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, computation);
    return computation;
  }

  /** Avisa que o dado destes domínios mudou (ver `CACHE_INVALIDATED_EVENT`). */
  private announce(namespaces: CacheNamespaceValue[]): void {
    if (namespaces.length === 0) return;

    const payload: CacheInvalidatedEvent = { namespaces };
    this.events?.emit(CACHE_INVALIDATED_EVENT, payload);
  }

  async get<T>(key: string, metricRoute?: string): Promise<T | undefined> {
    try {
      const value = await this.cache.get<T>(key);

      if (metricRoute) {
        if (value === undefined || value === null) {
          this.metrics.recordCacheMiss(metricRoute);
        } else {
          this.metrics.recordCacheHit(metricRoute);
        }
      }

      return value ?? undefined;
    } catch (error: unknown) {
      this.logger.warn(`Falha ao ler cache "${key}": ${errorMessage(error)}`);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMs);
    } catch (error: unknown) {
      this.logger.warn(
        `Falha ao gravar cache "${key}": ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Remove todas as chaves de um namespace.
   *
   * Chamado quando uma entidade do domínio muda — é o que substitui "esperar o
   * TTL expirar" por "some do cache no instante da escrita".
   */
  async invalidateNamespace(namespace: CacheNamespaceValue): Promise<number> {
    const pattern = `${namespace}:*`;

    // O L1 desta réplica sai junto; o das outras expira pelo TTL curto.
    this.hot.deleteByPrefix(`${namespace}:`);

    try {
      const store = (this.cache as unknown as { store?: RedisBackedStore })
        .store;
      const client = store?.client;

      if (!client?.scanIterator || !client.del) {
        this.logger.debug(
          `Store de cache não suporta SCAN — namespace "${namespace}" será invalidado só por TTL`,
        );
        return 0;
      }

      const keys: string[] = [];
      for await (const entry of client.scanIterator({
        MATCH: pattern,
        COUNT: 200,
      })) {
        if (Array.isArray(entry)) {
          keys.push(...entry);
        } else {
          keys.push(entry);
        }
      }

      if (keys.length === 0) {
        return 0;
      }

      await client.del(keys);
      this.logger.log(
        `Cache invalidado: ${keys.length} chave(s) em "${namespace}"`,
      );

      return keys.length;
    } catch (error: unknown) {
      this.logger.warn(
        `Falha ao invalidar namespace "${namespace}": ${errorMessage(error)}`,
      );
      return 0;
    }
  }

  async invalidateMany(namespaces: CacheNamespaceValue[]): Promise<void> {
    await Promise.all(
      namespaces.map((namespace) => this.invalidateNamespace(namespace)),
    );
    this.announce(namespaces);
  }

  async del(key: string): Promise<void> {
    this.hot.delete(key);

    try {
      await this.cache.del(key);
    } catch (error: unknown) {
      this.logger.warn(
        `Falha ao remover cache "${key}": ${errorMessage(error)}`,
      );
    }

    const namespace = namespaceOfKey(key);
    if (namespace) this.announce([namespace]);
  }
}
