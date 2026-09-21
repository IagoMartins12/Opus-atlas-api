/** Maior leitura aceita, em segundos. Acima disso é aba esquecida aberta. */
export const MAX_READ_SECONDS = 4 * 60 * 60;

/** Quantas vezes o tempo estimado uma leitura pode contar, no máximo. */
export const READ_CAP_FACTOR = 3;

/**
 * Quanto uma leitura conta na média.
 *
 * **O legado somava o que o cliente mandasse.** `readTime` vinha do corpo sem
 * validação: faltando, virava `NaN` na média; negativo, puxava para baixo;
 * dez horas de aba aberta, para cima. Aqui a leitura é limitada a três vezes o
 * tempo estimado do artigo — quem fica o triplo do tempo não está lendo, deixou
 * a aba aberta — e a quatro horas em qualquer caso.
 */
export function clampReadSeconds(
  seconds: number,
  estimatedMinutes: number | null,
): number {
  const byArticle = estimatedMinutes
    ? Math.max(estimatedMinutes * 60 * READ_CAP_FACTOR, 60)
    : MAX_READ_SECONDS;

  return Math.max(
    1,
    Math.min(Math.round(seconds), byArticle, MAX_READ_SECONDS),
  );
}

/** Média com uma leitura a mais. */
export function nextAverage(
  currentAverage: number | null,
  count: number,
  sample: number,
): number {
  return Math.round(((currentAverage ?? 0) * count + sample) / (count + 1));
}
