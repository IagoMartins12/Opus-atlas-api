import { createHash } from 'crypto';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespaceValue } from '../../common/cache/cache-keys';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
}

/**
 * Chave de cache de uma leitura do blog.
 *
 * **Começa sempre pelo namespace.** A invalidação procura `<namespace>:*`: uma
 * chave que comece com outra coisa nunca é limpa pelas escritas, e o site mostra
 * a versão antiga até o TTL vencer. Os parâmetros entram ordenados e resumidos,
 * para a mesma consulta dar a mesma chave em qualquer ordem.
 */
export function cacheKey(
  namespace: CacheNamespaceValue,
  kind: string,
  params?: Record<string, unknown>,
): string {
  if (!params) {
    return `${namespace}:${kind}`;
  }

  const digest = createHash('sha1')
    .update(JSON.stringify(sortKeys(params)))
    .digest('hex')
    .slice(0, 20);

  return `${namespace}:${kind}:${digest}`;
}

/**
 * Lê do cache, ou carrega e guarda.
 *
 * Falha do cache vira falta, nunca erro — o `AppCacheService` já garante: com o
 * Redis fora, a leitura fica lenta, não quebra.
 */
export async function cachedRead<T>(
  cache: AppCacheService,
  key: string,
  ttlMs: number,
  route: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key, route);

  if (hit !== undefined) {
    return hit;
  }

  const value = await load();
  await cache.set(key, value, ttlMs);
  return value;
}
