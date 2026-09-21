/**
 * Texto literal para os filtros de texto do Prisma no MongoDB.
 *
 * **O Prisma não escapa.** No MongoDB, `contains`, `startsWith`, `endsWith` e
 * `equals` com `mode: 'insensitive'` viram expressão regular com o texto como
 * veio. Medido na base: `contains: "."` casou os 19.177 compositores (64 têm
 * ponto no nome), e `"b.ch"` com `equals` insensível casou "Bach". Numa busca
 * pública isso é resultado errado, erro 500 com um `(` solto — e expressão
 * regular escolhida por quem pesquisa rodando no banco, inclusive uma de
 * retrocesso catastrófico que ocupa o servidor (ReDoS).
 *
 * Todo texto variável que entra num desses filtros passa por aqui; o teste
 * `regex-filters.spec.ts` confere que nenhum filtro novo nasce sem.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
