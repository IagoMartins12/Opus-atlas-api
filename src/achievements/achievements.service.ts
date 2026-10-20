import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AchievementCategory,
  AchievementRarity,
  NotificationPriority,
  NotificationType,
  Prisma,
  UserAchievement,
} from '@prisma/client';
import { NotificationsService } from '../portal/notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { errorMessage } from '../common/utils/error.util';
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENTS_BY_ID,
  AchievementDefinition,
  AchievementStats,
  isUnlocked,
  progressFor,
  xpFor,
} from './achievement-catalog';
import { AchievementStatsService } from './achievement-stats.service';

export interface UnlockedAchievement {
  badgeId: string;
  name: string;
  description: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  xpReward: number;
}

/** XP acumulado necessário para cada nível. */
const XP_PER_LEVEL = 100;

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: AchievementStatsService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------
  // Avaliação
  // -------------------------------------------------------------------

  /**
   * Avalia o catálogo inteiro e concede o que estiver desbloqueado.
   *
   * Duas garantias que o legado não tinha:
   *
   * 1. **XP só é creditado quando o badge é de fato criado.** Antes, o XP era
   *    somado a partir da lista de badges calculados, independentemente de o
   *    `upsert` ter criado a linha — duas chamadas simultâneas creditavam o
   *    dobro. Aqui a criação e o crédito acontecem na mesma transação, e uma
   *    violação de unicidade significa "outro processo já concedeu", não
   *    "concede de novo".
   * 2. **Todas as categorias são avaliadas.** No legado, só `LEARNING` somava
   *    XP; badges de favoritos e anotações eram gravados com `xpReward`
   *    preenchido mas nunca creditavam nada ao usuário.
   */
  async evaluate(userId: string): Promise<UnlockedAchievement[]> {
    const stats = await this.stats.collect(userId);

    const owned = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { badgeId: true },
    });

    const ownedIds = new Set(owned.map((entry) => entry.badgeId));

    const candidates = ACHIEVEMENT_CATALOG.filter(
      (badge) => !ownedIds.has(badge.id) && isUnlocked(badge, stats),
    );

    const granted: UnlockedAchievement[] = [];

    for (const badge of candidates) {
      const result = await this.grant(userId, badge, stats);

      if (result) {
        granted.push(result);
      }
    }

    await this.persistProgress(userId, stats, ownedIds);
    await this.announce(userId, granted);

    return granted;
  }

  /**
   * Avisa no sino que a conquista chegou. Uma conquista, um aviso; a primeira
   * avaliação de quem já tinha histórico pode soltar várias de uma vez, e aí
   * sai um aviso só, para o sino não virar uma lista de dez linhas iguais.
   */
  private async announce(
    userId: string,
    granted: UnlockedAchievement[],
  ): Promise<void> {
    if (granted.length === 0) return;

    const [first] = granted;
    const many = granted.length > 3;
    await this.notifications.notify({
      userId,
      type: NotificationType.ACHIEVEMENT_UNLOCKED,
      priority: NotificationPriority.LOW,
      title: many
        ? `${granted.length} conquistas desbloqueadas`
        : granted.length > 1
          ? 'Novas conquistas'
          : 'Conquista desbloqueada',
      message: many
        ? `${first.name} e mais ${granted.length - 1}. Veja todas na sua página de conquistas.`
        : granted.map((g) => `${g.name} (+${g.xpReward} XP)`).join(' · '),
      actionText: 'Ver conquistas',
      actionUrl: '/achievements',
      relatedEntityType: 'achievement',
      relatedEntityId: first.badgeId,
      metadata: { badgeIds: granted.map((g) => g.badgeId) },
    });
  }

  /**
   * Concede um badge e credita o XP na mesma transação.
   *
   * @returns `null` quando o badge já existia (corrida com outra avaliação).
   */
  private async grant(
    userId: string,
    badge: AchievementDefinition,
    stats: AchievementStats,
  ): Promise<UnlockedAchievement | null> {
    const xpReward = xpFor(badge);
    const { current, max } = progressFor(badge, stats);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.userAchievement.create({
          data: {
            userId,
            badgeId: badge.id,
            name: badge.name,
            description: badge.description,
            category: badge.category,
            rarity: badge.rarity,
            progress: current,
            maxProgress: max,
            xpReward,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { totalXP: { increment: xpReward } },
        });
      });

      return {
        badgeId: badge.id,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        rarity: badge.rarity,
        xpReward,
      };
    } catch (error: unknown) {
      // `@@unique([userId, badgeId])` resolve a corrida: quem perder recebe
      // P2002 e simplesmente não credita XP de novo.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }

      this.logger.error(
        `Falha ao conceder o badge ${badge.id} para ${userId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Grava o progresso rumo aos badges ainda bloqueados.
   *
   * O modelo `AchievementProgress` existia no schema e nunca era escrito pela
   * verificação — só por uma rota que aceitava `currentValue` direto do
   * cliente. Agora o valor vem do cálculo do servidor.
   */
  private async persistProgress(
    userId: string,
    stats: AchievementStats,
    ownedIds: Set<string>,
  ): Promise<void> {
    const pending = ACHIEVEMENT_CATALOG.filter(
      (badge) => !ownedIds.has(badge.id),
    );

    await Promise.all(
      pending.map(async (badge) => {
        const { current } = progressFor(badge, stats);

        await this.prisma.achievementProgress
          .upsert({
            where: { userId_badgeId: { userId, badgeId: badge.id } },
            update: {
              currentValue: current,
              lastCheckedAt: new Date(),
              lastProgressUpdate: new Date(),
            },
            create: { userId, badgeId: badge.id, currentValue: current },
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Falha ao gravar progresso de ${badge.id}: ${errorMessage(error)}`,
            );
          });
      }),
    );
  }

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------

  /** Conquistas do usuário, desbloqueadas e pendentes, com progresso. */
  async listForUser(userId: string) {
    const [unlocked, stats] = await Promise.all([
      this.prisma.userAchievement.findMany({
        where: { userId },
        orderBy: { unlockedAt: 'desc' },
      }),
      this.stats.collect(userId),
    ]);

    const unlockedIds = new Set(unlocked.map((entry) => entry.badgeId));

    const locked = ACHIEVEMENT_CATALOG.filter(
      (badge) => !unlockedIds.has(badge.id),
    ).map((badge) => {
      const { current, max } = progressFor(badge, stats);

      return {
        badgeId: badge.id,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        rarity: badge.rarity,
        xpReward: xpFor(badge),
        progress: current,
        maxProgress: max,
        percentage: max > 0 ? Math.round((current / max) * 100) : 0,
      };
    });

    return {
      unlocked: unlocked.map((entry) => this.toUnlockedDto(entry)),
      locked,
      summary: {
        unlockedCount: unlocked.length,
        totalCount: ACHIEVEMENT_CATALOG.length,
        newCount: unlocked.filter((entry) => entry.isNew).length,
      },
    };
  }

  /** Progresso rumo aos badges ainda não conquistados, do mais próximo. */
  async progressForUser(userId: string) {
    const { locked } = await this.listForUser(userId);

    return {
      pending: [...locked].sort((a, b) => b.percentage - a.percentage),
    };
  }

  /** XP total, nível e distribuição das conquistas por raridade. */
  async statsForUser(userId: string) {
    const [user, achievements] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { totalXP: true },
      }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { rarity: true, category: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const totalXP = user.totalXP;

    const byRarity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const achievement of achievements) {
      byRarity[achievement.rarity] = (byRarity[achievement.rarity] ?? 0) + 1;
      byCategory[achievement.category] =
        (byCategory[achievement.category] ?? 0) + 1;
    }

    const level = Math.floor(totalXP / XP_PER_LEVEL) + 1;
    const xpIntoLevel = totalXP % XP_PER_LEVEL;

    return {
      totalXP,
      level,
      xpIntoLevel,
      xpToNextLevel: XP_PER_LEVEL - xpIntoLevel,
      unlockedCount: achievements.length,
      totalCount: ACHIEVEMENT_CATALOG.length,
      byRarity,
      byCategory,
    };
  }

  /** Catálogo completo, sem dado de usuário. */
  catalog() {
    return {
      achievements: ACHIEVEMENT_CATALOG.map((badge) => ({
        badgeId: badge.id,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        rarity: badge.rarity,
        xpReward: xpFor(badge),
        threshold: badge.threshold,
      })),
      total: ACHIEVEMENT_CATALOG.length,
    };
  }

  /**
   * Conquistas ainda não vistas: o que o aviso em tempo real precisa saber.
   * Leitura mínima (uma consulta indexada por usuário), feita para ser
   * repetida a cada poucos segundos — a lista completa recalcula as estatísticas.
   */
  async listNew(userId: string) {
    const entries = await this.prisma.userAchievement.findMany({
      where: { userId, isNew: true },
      orderBy: { unlockedAt: 'desc' },
      take: 20,
    });

    return { unlocked: entries.map((entry) => this.toUnlockedDto(entry)) };
  }

  /**
   * Marca a conquista como vista, para o aviso não reaparecer.
   *
   * O `badgeId` é validado contra o catálogo antes de tocar no banco: sem isso,
   * um id inventado gastaria uma escrita e devolveria 404 depois.
   */
  async markAsViewed(userId: string, badgeId: string): Promise<void> {
    if (!ACHIEVEMENTS_BY_ID.has(badgeId)) {
      throw new NotFoundException('Conquista não encontrada');
    }

    const updated = await this.prisma.userAchievement.updateMany({
      where: { userId, badgeId },
      data: {
        isNew: false,
        lastViewedAt: new Date(),
        notificationShown: true,
        notificationShownAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Conquista não encontrada');
    }
  }

  private toUnlockedDto(entry: UserAchievement) {
    return {
      badgeId: entry.badgeId,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      rarity: entry.rarity,
      xpReward: entry.xpReward,
      isNew: entry.isNew,
      unlockedAt: entry.unlockedAt,
    };
  }
}
