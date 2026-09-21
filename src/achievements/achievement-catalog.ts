import { AchievementCategory, AchievementRarity } from '@prisma/client';

/**
 * XP por raridade. Uma raridade define a recompensa; não há XP avulso por
 * badge, o que evita que dois badges igualmente difíceis paguem valores
 * diferentes por descuido.
 */
export const XP_BY_RARITY: Record<AchievementRarity, number> = {
  COMMON: 10,
  RARE: 25,
  EPIC: 50,
  LEGENDARY: 100,
};

/**
 * Métricas do usuário sobre as quais os badges são avaliados.
 *
 * Toda métrica é calculada pelo servidor a partir do dado real. Nenhuma vem do
 * cliente — no legado, `POST /achievements` aceitava `badgeId`, `name` e
 * `rarity` do corpo da requisição, então qualquer usuário podia conceder a si
 * mesmo um badge LENDÁRIO e 100 XP quantas vezes quisesse.
 */
export interface AchievementStats {
  // Aprendizado
  wantToLearnCount: number;
  learnedCount: number;
  totalLearning: number;
  /** Obras com maestria 4 ou 5. */
  expertLevelCount: number;
  avgMastery: number;
  /** Percentual de obras iniciadas que foram concluídas. */
  completionRate: number;
  /** Dias seguidos concluindo obras. */
  learningStreak: number;

  // Coleção
  favoriteComposers: number;
  favoriteWorks: number;
  favoriteScores: number;
  totalFavorites: number;
  /** Épocas distintas entre as obras favoritadas. */
  epochsCount: number;
  /** Instrumentos distintos entre as obras favoritadas. */
  instrumentsCount: number;
  /** Obras favoritadas do compositor mais favoritado. */
  topComposerWorks: number;
  /** Dias seguidos favoritando algo. */
  favoriteStreak: number;
  /** Itens favoritados nos últimos 30 dias. */
  recentDiscoveries: number;

  // Comunidade
  annotationsCount: number;
  helpfulVotes: number;
  verifiedAnnotations: number;

  // Performance
  publicPerformances: number;

  // Contribuição ao catálogo
  contributions: number;
}

export type AchievementMetric = keyof AchievementStats;

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  /** Métrica avaliada. */
  metric: AchievementMetric;
  /** Valor da métrica que desbloqueia o badge. */
  threshold: number;
  /**
   * Fator de escala para exibir progresso em métricas fracionárias.
   * Maestria média 4.5 vira progresso 45/45 com `progressScale: 10`.
   */
  progressScale?: number;
}

/**
 * Catálogo único de conquistas.
 *
 * Antes existiam dois catálogos divergentes: um no componente do front, com 20
 * badges e critérios próprios, e outro embutido na rota de verificação, com 13
 * badges e limiares diferentes. O mesmo badge tinha nome e dificuldade
 * distintos nos dois lados, e o front exibia badges que o servidor nunca
 * concedia. Agora o catálogo é um só, aqui, e o front apenas o consome.
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  // ---------------------------------------------------------------
  // Marcos iniciais
  // ---------------------------------------------------------------
  {
    id: 'first-goal',
    name: 'Primeiro Objetivo',
    description: 'Adicione sua primeira obra à lista de estudos.',
    category: AchievementCategory.MILESTONE,
    rarity: AchievementRarity.COMMON,
    metric: 'totalLearning',
    threshold: 1,
  },
  {
    id: 'first-favorite',
    name: 'Primeiro Favorito',
    description: 'Salve seu primeiro item musical favorito.',
    category: AchievementCategory.MILESTONE,
    rarity: AchievementRarity.COMMON,
    metric: 'totalFavorites',
    threshold: 1,
  },
  {
    id: 'first-mastery',
    name: 'Primeira Conquista',
    description: 'Conclua sua primeira obra.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.COMMON,
    metric: 'learnedCount',
    threshold: 1,
  },
  {
    id: 'first-contribution',
    name: 'Primeira Contribuição',
    description: 'Compartilhe sua primeira anotação com a comunidade.',
    category: AchievementCategory.ANNOTATIONS,
    rarity: AchievementRarity.COMMON,
    metric: 'annotationsCount',
    threshold: 1,
  },
  {
    id: 'first-helpful',
    name: 'Primeira Ajuda',
    description: 'Tenha uma anotação marcada como útil.',
    category: AchievementCategory.ANNOTATIONS,
    rarity: AchievementRarity.COMMON,
    metric: 'helpfulVotes',
    threshold: 1,
  },

  // ---------------------------------------------------------------
  // Aprendizado
  // ---------------------------------------------------------------
  {
    id: 'dedicated-student',
    name: 'Estudante Dedicado',
    description: 'Tenha 10 obras na sua lista de estudos.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.COMMON,
    metric: 'wantToLearnCount',
    threshold: 10,
  },
  {
    id: 'experienced-musician',
    name: 'Músico Experiente',
    description: 'Conclua 15 obras.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.RARE,
    metric: 'learnedCount',
    threshold: 15,
  },
  {
    id: 'skilled-musician',
    name: 'Músico Habilidoso',
    description: 'Domine 10 obras com maestria 4 ou superior.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.RARE,
    metric: 'expertLevelCount',
    threshold: 10,
  },
  {
    id: 'perfectionist',
    name: 'Perfeccionista',
    description: 'Mantenha maestria média de 4,5 ou superior.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.EPIC,
    metric: 'avgMastery',
    threshold: 4.5,
    progressScale: 10,
  },
  {
    id: 'efficient-learner',
    name: 'Aprendiz Eficiente',
    description: 'Conclua 90% das obras que iniciar.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.EPIC,
    metric: 'completionRate',
    threshold: 90,
  },
  {
    id: 'consistent-learner',
    name: 'Aprendiz Consistente',
    description: 'Conclua obras por 7 dias seguidos.',
    category: AchievementCategory.LEARNING,
    rarity: AchievementRarity.RARE,
    metric: 'learningStreak',
    threshold: 7,
  },

  // ---------------------------------------------------------------
  // Coleção
  // ---------------------------------------------------------------
  {
    id: 'collector-bronze',
    name: 'Colecionador Bronze',
    description: 'Acumule 10 favoritos.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.COMMON,
    metric: 'totalFavorites',
    threshold: 10,
  },
  {
    id: 'collector-silver',
    name: 'Colecionador Prata',
    description: 'Acumule 50 favoritos.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.RARE,
    metric: 'totalFavorites',
    threshold: 50,
  },
  {
    id: 'collector-gold',
    name: 'Colecionador Ouro',
    description: 'Acumule 100 favoritos.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.EPIC,
    metric: 'totalFavorites',
    threshold: 100,
  },
  {
    id: 'composer-fan',
    name: 'Fã de Compositor',
    description: 'Favorite 5 obras do mesmo compositor.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.RARE,
    metric: 'topComposerWorks',
    threshold: 5,
  },
  {
    id: 'epoch-explorer',
    name: 'Explorador de Épocas',
    description: 'Favorite obras de 4 épocas musicais diferentes.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.RARE,
    metric: 'epochsCount',
    threshold: 4,
  },
  {
    id: 'multi-instrument',
    name: 'Multi-Instrumental',
    description: 'Favorite obras para 6 instrumentos diferentes.',
    category: AchievementCategory.FAVORITES,
    rarity: AchievementRarity.EPIC,
    metric: 'instrumentsCount',
    threshold: 6,
  },
  {
    id: 'daily-discovery',
    name: 'Descobridor Diário',
    description: 'Favorite algo por 3 dias seguidos.',
    category: AchievementCategory.GENERAL,
    rarity: AchievementRarity.RARE,
    metric: 'favoriteStreak',
    threshold: 3,
  },
  {
    id: 'music-archaeologist',
    name: 'Arqueólogo Musical',
    description: 'Descubra 20 obras nos últimos 30 dias.',
    category: AchievementCategory.GENERAL,
    rarity: AchievementRarity.EPIC,
    metric: 'recentDiscoveries',
    threshold: 20,
  },

  // ---------------------------------------------------------------
  // Comunidade
  // ---------------------------------------------------------------
  {
    id: 'active-contributor',
    name: 'Contribuidor Ativo',
    description: 'Publique 15 anotações.',
    category: AchievementCategory.ANNOTATIONS,
    rarity: AchievementRarity.RARE,
    metric: 'annotationsCount',
    threshold: 15,
  },
  {
    id: 'helpful-expert',
    name: 'Expert Útil',
    description: 'Receba 50 votos de "útil" nas suas anotações.',
    category: AchievementCategory.ANNOTATIONS,
    rarity: AchievementRarity.EPIC,
    metric: 'helpfulVotes',
    threshold: 50,
  },
  {
    id: 'verified-scholar',
    name: 'Estudioso Verificado',
    description: 'Tenha 5 anotações verificadas por especialistas.',
    category: AchievementCategory.ANNOTATIONS,
    rarity: AchievementRarity.EPIC,
    metric: 'verifiedAnnotations',
    threshold: 5,
  },
  {
    id: 'catalog-builder',
    name: 'Construtor do Catálogo',
    description: 'Envie 10 contribuições aceitas ao catálogo.',
    category: AchievementCategory.SOCIAL,
    rarity: AchievementRarity.RARE,
    metric: 'contributions',
    threshold: 10,
  },

  // ---------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------
  {
    id: 'stage-debut',
    name: 'Estreia no Palco',
    description: 'Registre sua primeira performance pública.',
    category: AchievementCategory.SOCIAL,
    rarity: AchievementRarity.RARE,
    metric: 'publicPerformances',
    threshold: 1,
  },
  {
    id: 'performer',
    name: 'Performer Experiente',
    description: 'Registre 5 performances públicas.',
    category: AchievementCategory.SOCIAL,
    rarity: AchievementRarity.EPIC,
    metric: 'publicPerformances',
    threshold: 5,
  },

  // ---------------------------------------------------------------
  // Lendárias
  // ---------------------------------------------------------------
  {
    id: 'classical-guru',
    name: 'Guru Clássico',
    description: 'Alcance 200 favoritos.',
    category: AchievementCategory.MILESTONE,
    rarity: AchievementRarity.LEGENDARY,
    metric: 'totalFavorites',
    threshold: 200,
  },
  {
    id: 'musical-master',
    name: 'Mestre Musical',
    description: 'Domine 50 obras com maestria 4 ou superior.',
    category: AchievementCategory.MILESTONE,
    rarity: AchievementRarity.LEGENDARY,
    metric: 'expertLevelCount',
    threshold: 50,
  },
];

/** Índice por id, para consulta direta sem varrer o catálogo. */
export const ACHIEVEMENTS_BY_ID = new Map(
  ACHIEVEMENT_CATALOG.map((badge) => [badge.id, badge]),
);

/** XP que o badge concede, derivado da raridade. */
export function xpFor(badge: AchievementDefinition): number {
  return XP_BY_RARITY[badge.rarity];
}

/**
 * Progresso do usuário rumo a um badge, já escalado para exibição.
 *
 * O valor é limitado ao máximo: mostrar "250/200 favoritos" numa barra de
 * progresso não faz sentido.
 */
export function progressFor(
  badge: AchievementDefinition,
  stats: AchievementStats,
): { current: number; max: number } {
  const scale = badge.progressScale ?? 1;
  const raw = stats[badge.metric] * scale;
  const max = Math.round(badge.threshold * scale);

  return { current: Math.min(Math.round(raw), max), max };
}

/** Um badge está desbloqueado quando a métrica atinge o limiar. */
export function isUnlocked(
  badge: AchievementDefinition,
  stats: AchievementStats,
): boolean {
  return stats[badge.metric] >= badge.threshold;
}
