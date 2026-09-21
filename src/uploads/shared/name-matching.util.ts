/**
 * Comparação de nomes de compositor para detecção de duplicata.
 *
 * O catálogo recebe o mesmo compositor grafado de muitas formas: "Mozart,
 * Wolfgang Amadeus" vindo do IMSLP, "Wolfgang Amadeus Mozart" digitado à mão,
 * "W. A. Mozart" numa edição antiga. Comparar as strings cruas deixaria passar
 * todas as duplicatas.
 *
 * Portado de `uploads/composer/check-duplicate/route.ts`, onde a lógica vivia
 * misturada ao handler HTTP.
 */

/** Normaliza pontuação e espaçamento antes de qualquer comparação. */
export function cleanNameForComparison(name: string): string {
  return name
    .replace(/[(),]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Diz se dois nomes provavelmente designam a mesma pessoa.
 *
 * Compara conjuntos de palavras em vez de a string inteira, o que resolve
 * inversão de ordem ("Mozart, Wolfgang" vs "Wolfgang Mozart"). Palavras de até
 * dois caracteres são descartadas: partículas como "de", "van" e "di" aparecem
 * em nomes de pessoas diferentes e só adicionariam ruído.
 *
 * O limiar de 80% das palavras em comum admite um nome do meio a mais ou a
 * menos sem admitir dois compositores que só compartilham o sobrenome.
 */
export function isSimilarName(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  if (!first || !second) {
    return false;
  }

  const cleanFirst = cleanNameForComparison(first.toLowerCase());
  const cleanSecond = cleanNameForComparison(second.toLowerCase());

  if (cleanFirst === cleanSecond) {
    return true;
  }

  const wordsFirst = cleanFirst
    .split(' ')
    .filter((word) => word.length > 2)
    .sort();
  const wordsSecond = cleanSecond
    .split(' ')
    .filter((word) => word.length > 2)
    .sort();

  const common = wordsFirst.filter((word) => wordsSecond.includes(word));
  const smallest = Math.min(wordsFirst.length, wordsSecond.length);

  return smallest > 0 && common.length / smallest >= 0.8;
}

/**
 * Grafias alternativas de um nome, para busca direta no banco.
 *
 * A busca por igualdade é indexável; a comparação difusa de `isSimilarName`
 * não é. Gerar as variações mais comuns permite achar a maior parte das
 * duplicatas com uma consulta que usa índice, em vez de varrer a coleção.
 */
export function generateNameVariations(fullName: string): string[] {
  const cleaned = cleanNameForComparison(fullName);
  const parts = cleaned.split(' ').filter(Boolean);

  if (parts.length < 2) {
    return [];
  }

  const variations: string[] = [];
  const lastName = parts[parts.length - 1];
  const firstNames = parts.slice(0, -1).join(' ');

  // "Mozart, Wolfgang Amadeus" — convenção de catálogo.
  variations.push(`${lastName}, ${firstNames}`);

  if (parts.length > 2) {
    // "Wolfgang Mozart" — sem os nomes do meio.
    variations.push(`${parts[0]} ${lastName}`);

    // "W. A. Mozart" — iniciais.
    const initials = parts
      .slice(0, -1)
      .map((part) => `${part.charAt(0)}.`)
      .join(' ');
    variations.push(`${initials} ${lastName}`);
  }

  variations.push(fullName.replace(/,/g, '').trim());

  return [...new Set(variations)].filter((variation) => variation !== fullName);
}

/**
 * Extrai o identificador de uma URL do IMSLP.
 *
 * `https://imslp.org/wiki/Category:Mozart,_Wolfgang_Amadeus`
 * → `Category:Mozart,_Wolfgang_Amadeus`
 */
export function extractImslpId(url: string): string | null {
  const match = /\/wiki\/(.+)$/.exec(url);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    // URL com escape malformado: o trecho cru ainda serve para comparar.
    return match[1];
  }
}
