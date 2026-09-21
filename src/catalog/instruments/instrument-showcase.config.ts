/**
 * Curadoria da página de instrumentos (`/instruments` no front): quais
 * instrumentos aparecem e, por instrumento, o compositor em destaque, os
 * compositores fora e as obras escolhidas.
 *
 * Morava no `pageServer` do front, que montava a página lendo o banco direto;
 * veio para cá na Etapa 3, como a curadoria de épocas (`COMPOSERS_BY_EPOCH`).
 * O texto histórico de cada instrumento continua conteúdo estático do front.
 */

/** Os instrumentos da página, na ordem em que aparecem. */
export const SHOWCASE_INSTRUMENTS = [
  'Piano',
  'Órgão',
  'Violoncelo',
  'Violino',
  'Clavicórdio',
  'Orquestra',
  'Harpa',
];

export const SHOWCASE_MAX_WORKS = 20;
export const SHOWCASE_TOP_COMPOSERS = 5;

export interface ShowcaseComposerPreference {
  /** Destaque: as obras e o ranking do instrumento passam a ser só dele. */
  preferredComposerId?: string;
  excludedComposerIds?: string[];
}

export interface ShowcaseWorksPreference {
  /** Obras de um compositor: as indicadas primeiro, depois as dele até `count`. */
  composerWorks?: Record<
    string,
    { count: number; specificWorkIds?: string[]; specificWorkTitles?: string[] }
  >;
  totalMaxWorks?: number;
  /** Completa com outras obras do instrumento até o máximo (padrão: sim). */
  fallbackToAutomatic?: boolean;
}

export const SHOWCASE_COMPOSER_PREFERENCES: Record<
  string,
  ShowcaseComposerPreference
> = {
  Piano: { preferredComposerId: '685e1087c6bd886c5b495d66' }, // Chopin
  Violino: { preferredComposerId: '685f0770c6bd886c5b4982af' }, // Paganini
  Violoncelo: { preferredComposerId: '685d8f9a8803000f9b61d151' }, // Bach
  Órgão: { preferredComposerId: '685d8f9a8803000f9b61d151' }, // Bach
  Orquestra: { excludedComposerIds: ['683a7e9af8ced962eff7c0d8'] },
};

export const SHOWCASE_WORKS_PREFERENCES: Record<
  string,
  ShowcaseWorksPreference
> = {
  Piano: {
    composerWorks: { '683bb049320ed96f5ac321a8': { count: 3 } },
    totalMaxWorks: 20,
    fallbackToAutomatic: true,
  },
};
