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

/**
 * A tag do front para a página de uma obra só — a mesma que as leituras da
 * página (`work-page-details.ts`, `work-score-library.ts`) levam além de
 * `works`. Permite limpar uma obra sem esvaziar todas.
 */
export function workTag(workId: string): string {
  return `work:${workId}`;
}
