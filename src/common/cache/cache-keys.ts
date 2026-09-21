/**
 * Namespaces de cache por domínio.
 *
 * Toda chave gravada pela aplicação começa por um destes prefixos, o que
 * permite invalidar um domínio inteiro sem conhecer as chaves individuais
 * (que hoje embutem assinatura de filtros e são impossíveis de enumerar).
 */
export const CacheNamespace = {
  WORKS: 'works',
  COMPOSERS: 'composers',
  EPOCHS: 'epochs',
  INSTRUMENTS: 'instruments',
  DISCOVERY: 'discovery',
  BLOG_ARTICLES: 'blog:articles',
  BLOG_CATEGORIES: 'blog:categories',
  BLOG_TAGS: 'blog:tags',
  BLOG_CALENDAR: 'blog:calendar',
  TEACHERS: 'teachers',
} as const;

export type CacheNamespaceValue =
  (typeof CacheNamespace)[keyof typeof CacheNamespace];

/**
 * Evento emitido a cada limpeza de cache — "o dado destes domínios mudou".
 *
 * Quem escuta é a revalidação do front (`RevalidationService`): o cache do Next
 * é independente do da API, então o aviso sai **mesmo quando o Redis não tinha
 * chave nenhuma** a apagar.
 */
export const CACHE_INVALIDATED_EVENT = 'cache.invalidated';

export interface CacheInvalidatedEvent {
  namespaces: CacheNamespaceValue[];
}

/** O namespace de uma chave (`works:detail:1` → `works`), se for conhecido. */
export function namespaceOfKey(key: string): CacheNamespaceValue | null {
  const known = Object.values(CacheNamespace) as CacheNamespaceValue[];

  // O mais longo primeiro: `blog:articles` antes de um eventual `blog`.
  return (
    [...known]
      .sort((a, b) => b.length - a.length)
      .find((namespace) => key.startsWith(`${namespace}:`)) ?? null
  );
}

/**
 * O que uma escrita em compositor ou obra deixa desatualizado.
 *
 * Numa lista só porque cada escritor tinha a sua, e três estavam incompletas:
 * as páginas de história (`epochs`) listam compositores por época com TTL de
 * 6 horas, e as descobertas e adições recentes (`discovery`) mostram obras e
 * compositores novos.
 */
export const CATALOG_NAMESPACES: CacheNamespaceValue[] = [
  CacheNamespace.WORKS,
  CacheNamespace.COMPOSERS,
  CacheNamespace.DISCOVERY,
  CacheNamespace.EPOCHS,
];

/**
 * TTLs padronizados.
 *
 * A regra por trás dos números: quanto mais mutável o dado, mais curto o TTL.
 * Enquanto o front ainda escreve direto no MongoDB (fora da API), a API não
 * recebe evento nenhum dessas escritas — então TTL longo em entidade mutável
 * significa "editei e não mudou" por horas. Os TTLs longos ficam reservados
 * para dado quase estático, que praticamente não muda.
 */
export const CacheTtl = {
  /** Listagens e detalhes que admins e a comunidade editam. */
  MUTABLE: 5 * 60 * 1000,
  /** Agregações caras cuja defasagem curta é aceitável. */
  AGGREGATE: 15 * 60 * 1000,
  /** Dado quase estático (épocas, instrumentos, papéis). */
  STATIC: 6 * 60 * 60 * 1000,
} as const;
