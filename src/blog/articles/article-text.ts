/**
 * Slug e tempo de leitura dos artigos do blog.
 */

/** Formato de slug aceito na escrita: minúsculas, dígitos e hífens simples. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Slug a partir de um nome — **o mesmo algoritmo do legado, byte a byte.**
 *
 * É a chave do `upsert` das tags, e o legado continua escrevendo na mesma
 * base enquanto o front não migra. Um algoritmo diferente criaria tag
 * duplicada: `createSlug`, que os scrapers usam, **apaga** a pontuação
 * ("Bach's" → `bachs`), e o legado a **troca por hífen** (`bach-s`). As duas
 * tags passariam a existir lado a lado, cada uma com metade dos artigos.
 */
export function blogSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Próximo slug livre para a cópia de um artigo.
 *
 * Mesma sequência do legado — `-copia`, `-copia-1`, `-copia-2` —, mas
 * resolvida contra um conjunto já carregado, em vez de uma consulta ao banco
 * por tentativa.
 */
export function copySlug(base: string, taken: ReadonlySet<string>): string {
  let candidate = `${base}-copia`;
  let counter = 1;

  while (taken.has(candidate)) {
    candidate = `${base}-copia-${counter}`;
    counter += 1;
  }

  return candidate;
}

export const WORDS_PER_MINUTE = 200;

/**
 * Tempo estimado de leitura, em minutos.
 *
 * **O legado contava o JSON, não o texto.** A fórmula era
 * `JSON.stringify(content).split(/\s+/).length / 200` — que conta chaves,
 * nomes de nó e atributos junto com as palavras. Medido nas três matérias da
 * base, o resultado errou para menos nas duas longas (21 minutos para 4.473
 * palavras, que dão 23), e o erro cresce com a quantidade de formatação, não
 * com a de texto. Aqui a conta usa só as palavras do texto corrido.
 */
export function estimateReadTime(words: number): number | null {
  return words > 0 ? Math.ceil(words / WORDS_PER_MINUTE) : null;
}
