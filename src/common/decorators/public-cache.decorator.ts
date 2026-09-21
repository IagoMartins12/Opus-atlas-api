import { SetMetadata } from '@nestjs/common';

export const PUBLIC_CACHE_KEY = 'publicCache';

export interface PublicCacheOptions {
  /** Por quanto tempo um cache compartilhado pode servir a resposta sem perguntar. */
  maxAgeSeconds: number;
  /**
   * Janela em que a resposta vencida ainda pode ser servida enquanto o cache a
   * renova em segundo plano. É o que evita o "efeito manada" no vencimento:
   * sem isso, todo mundo que chega no segundo seguinte ao vencimento cai na
   * origem ao mesmo tempo.
   */
  staleWhileRevalidateSeconds?: number;
}

/**
 * Declara que a resposta desta rota **não depende de quem pediu** e pode ser
 * guardada por caches compartilhados (CDN, proxy reverso, cache de `fetch` do
 * Next).
 *
 * A anotação é o contrato, não uma heurística: quem a coloca afirma que a
 * resposta é a mesma para visitante anônimo e para usuário logado. Usar em
 * rota cuja resposta varia por usuário vaza dado de um para outro.
 *
 * Só tem efeito em `GET` com resposta de sucesso — ver `PublicCacheInterceptor`.
 */
export const PublicCache = (options: PublicCacheOptions) =>
  SetMetadata(PUBLIC_CACHE_KEY, options);
