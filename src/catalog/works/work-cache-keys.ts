import { CacheNamespace } from '../../common/cache/cache-keys';

/**
 * Chave do detalhe de uma obra.
 *
 * Numa função só porque três lugares a usam — quem grava, a edição de mídia e a
 * busca de mídia — e uma cópia escrita à mão já divergiu uma vez: o catálogo
 * gravava `catalog:works:detail:<id>`, fora do namespace que as escritas limpam.
 */
export function workDetailCacheKey(workId: string): string {
  return `${CacheNamespace.WORKS}:detail:${workId}`;
}
