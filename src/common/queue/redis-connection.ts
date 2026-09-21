import { ConnectionOptions } from 'bullmq';

/**
 * Traduz `REDIS_URL` para as opções de conexão do BullMQ.
 *
 * O resto do projeto entrega a URL inteira para o `cache-manager-redis-yet`,
 * que fala com o cliente `redis` (node-redis). O BullMQ fala com `ioredis`, e
 * `ioredis` não aceita URL dentro do objeto de opções — só no construtor. Como
 * o `@nestjs/bullmq` monta o cliente por dentro, a URL precisa ser aberta aqui.
 *
 * Duas opções não são estética e o BullMQ recusa a conexão sem a primeira:
 *
 * - `maxRetriesPerRequest: null` — o worker fica **bloqueado** num `BRPOPLPUSH`
 *   esperando job. Com o padrão do `ioredis` (20 tentativas), uma espera longa
 *   é interpretada como comando travado e a conexão é derrubada sozinha.
 * - `enableReadyCheck: false` — o `INFO` do ready check é bloqueado por vários
 *   Redis gerenciados, e sem isto o cliente nunca sai de "conectando" neles.
 */
export function parseRedisUrl(url: string): ConnectionOptions {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `REDIS_URL inválida para a fila: "${url}". Esperado redis://host:porta.`,
    );
  }

  const isSecure = parsed.protocol === 'rediss:';

  if (parsed.protocol !== 'redis:' && !isSecure) {
    throw new Error(
      `Protocolo não suportado em REDIS_URL: "${parsed.protocol}". Use redis:// ou rediss://.`,
    );
  }

  // `/0`, `/1`… é o índice do banco; a barra sozinha não é índice nenhum.
  const database = parsed.pathname.replace(/^\//, '');

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(isSecure ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
