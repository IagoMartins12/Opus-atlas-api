/**
 * Quão conhecida uma obra é, de 0 a 1000: a ordem "em destaque" do catálogo.
 *
 * **Por que um número gravado.** O destaque punha antes as obras de dez
 * compositores famosos e as ordenava pelas anotações — quase sempre zero —,
 * então na prática era A–Z: "10 Orgel-Choräle" na frente dos Noturnos. A fama
 * de uma obra é coisa que se mede, e a melhor medida que o acervo tem são os
 * downloads das partituras no IMSLP (o Cânone de Pachelbel passa de um milhão;
 * uma cantata esquecida tem dezenas). Calculada para 200 mil obras a cada
 * página seria inviável; gravada, ordena por índice.
 *
 * Os sinais, do mais forte ao mais fraco:
 * - **downloads no IMSLP**, em escala logarítmica (cada dez vezes mais
 *   downloads vale o mesmo degrau): 1 milhão ≈ 600, 10 mil ≈ 400, 100 ≈ 200;
 * - **nome popular** ("Sonata ao Luar") ou **partes famosas**, da lista
 *   editorial: a obra que o público chama por apelido é conhecida mesmo sem
 *   partitura lida;
 * - **pessoas no Opus Atlas**: quem estuda, aprendeu, favoritou ou anotou;
 * - **gravação** encontrada (Spotify ou YouTube) e **compositor famoso**, como
 *   desempate entre as que não têm outro sinal.
 */
export interface ProminenceSignals {
  /** Soma dos downloads das partituras da obra no IMSLP. */
  downloads: number;
  hasPopularName: boolean;
  hasFamousParts: boolean;
  /** Quero aprender + já aprendi + favoritos + anotações. */
  people: number;
  hasRecording: boolean;
  byFamousComposer: boolean;
}

export const PROMINENCE_MAX = 1000;

const POPULAR_NAME = 250;
const FAMOUS_PARTS = 100;
const RECORDING = 30;
const FAMOUS_COMPOSER = 50;

export function prominenceOf(s: ProminenceSignals): number {
  const downloads = 100 * Math.log10(1 + Math.max(0, s.downloads));
  const people = 40 * Math.log2(1 + Math.max(0, s.people));
  const total =
    downloads +
    (s.hasPopularName ? POPULAR_NAME : 0) +
    (s.hasFamousParts ? FAMOUS_PARTS : 0) +
    people +
    (s.hasRecording ? RECORDING : 0) +
    (s.byFamousComposer ? FAMOUS_COMPOSER : 0);
  return Math.min(PROMINENCE_MAX, Math.round(total));
}
