import { AchievementRarity } from '@prisma/client';
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENTS_BY_ID,
  AchievementStats,
  isUnlocked,
  progressFor,
  XP_BY_RARITY,
  xpFor,
} from './achievement-catalog';

const emptyStats = (): AchievementStats => ({
  wantToLearnCount: 0,
  learnedCount: 0,
  totalLearning: 0,
  expertLevelCount: 0,
  avgMastery: 0,
  completionRate: 0,
  learningStreak: 0,
  favoriteComposers: 0,
  favoriteWorks: 0,
  favoriteScores: 0,
  totalFavorites: 0,
  epochsCount: 0,
  instrumentsCount: 0,
  topComposerWorks: 0,
  favoriteStreak: 0,
  recentDiscoveries: 0,
  annotationsCount: 0,
  helpfulVotes: 0,
  verifiedAnnotations: 0,
  publicPerformances: 0,
  contributions: 0,
});

describe('catálogo de conquistas', () => {
  it('não tem badgeId repetido', () => {
    const ids = ACHIEVEMENT_CATALOG.map((badge) => badge.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indexa todos os badges por id', () => {
    expect(ACHIEVEMENTS_BY_ID.size).toBe(ACHIEVEMENT_CATALOG.length);
  });

  it('define limiar positivo em todo badge', () => {
    for (const badge of ACHIEVEMENT_CATALOG) {
      expect(badge.threshold).toBeGreaterThan(0);
    }
  });

  it('dá nome e descrição a todo badge', () => {
    for (const badge of ACHIEVEMENT_CATALOG) {
      expect(badge.name.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(0);
    }
  });

  // A recompensa vem da raridade, não de um número por badge: dois badges
  // igualmente difíceis não podem pagar valores diferentes por descuido.
  it('deriva o XP da raridade', () => {
    for (const badge of ACHIEVEMENT_CATALOG) {
      expect(xpFor(badge)).toBe(XP_BY_RARITY[badge.rarity]);
    }
  });

  it('reserva a raridade lendária para poucos badges', () => {
    const legendary = ACHIEVEMENT_CATALOG.filter(
      (badge) => badge.rarity === AchievementRarity.LEGENDARY,
    );

    expect(legendary.length).toBeGreaterThan(0);
    expect(legendary.length).toBeLessThanOrEqual(3);
  });
});

describe('isUnlocked', () => {
  it('desbloqueia quando a métrica atinge o limiar', () => {
    const stats = { ...emptyStats(), totalFavorites: 10 };
    const badge = ACHIEVEMENTS_BY_ID.get('collector-bronze')!;

    expect(isUnlocked(badge, stats)).toBe(true);
  });

  it('mantém bloqueado abaixo do limiar', () => {
    const stats = { ...emptyStats(), totalFavorites: 9 };
    const badge = ACHIEVEMENTS_BY_ID.get('collector-bronze')!;

    expect(isUnlocked(badge, stats)).toBe(false);
  });

  it('desbloqueia acima do limiar', () => {
    const stats = { ...emptyStats(), totalFavorites: 500 };
    const badge = ACHIEVEMENTS_BY_ID.get('collector-bronze')!;

    expect(isUnlocked(badge, stats)).toBe(true);
  });

  it('trata limiar fracionário de maestria média', () => {
    const badge = ACHIEVEMENTS_BY_ID.get('perfectionist')!;

    expect(isUnlocked(badge, { ...emptyStats(), avgMastery: 4.5 })).toBe(true);
    expect(isUnlocked(badge, { ...emptyStats(), avgMastery: 4.49 })).toBe(
      false,
    );
  });
});

describe('progressFor', () => {
  it('devolve o valor atual e o máximo', () => {
    const badge = ACHIEVEMENTS_BY_ID.get('collector-gold')!;

    expect(progressFor(badge, { ...emptyStats(), totalFavorites: 37 })).toEqual(
      {
        current: 37,
        max: 100,
      },
    );
  });

  // Mostrar "250/200" numa barra de progresso não faz sentido.
  it('limita o progresso ao máximo', () => {
    const badge = ACHIEVEMENTS_BY_ID.get('collector-bronze')!;

    expect(
      progressFor(badge, { ...emptyStats(), totalFavorites: 250 }),
    ).toEqual({ current: 10, max: 10 });
  });

  // Maestria média 4.5 vira 45/45, para caber numa barra inteira.
  it('escala métrica fracionária para exibição', () => {
    const badge = ACHIEVEMENTS_BY_ID.get('perfectionist')!;

    expect(progressFor(badge, { ...emptyStats(), avgMastery: 4.2 })).toEqual({
      current: 42,
      max: 45,
    });
  });

  it('devolve zero para usuário sem atividade', () => {
    for (const badge of ACHIEVEMENT_CATALOG) {
      expect(progressFor(badge, emptyStats()).current).toBe(0);
    }
  });
});
