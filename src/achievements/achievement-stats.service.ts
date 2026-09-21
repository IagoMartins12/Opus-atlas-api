import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementStats } from './achievement-catalog';

/** Janela usada pelo badge de descobertas recentes. */
const RECENT_WINDOW_DAYS = 30;

/** Maestria a partir da qual a obra conta como dominada. */
const EXPERT_MASTERY = 4;

@Injectable()
export class AchievementStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula todas as métricas do usuário numa única rodada.
   *
   * Tudo é lido do dado real: nenhuma métrica vem do cliente. As consultas são
   * disparadas em paralelo porque nenhuma depende do resultado da outra, e uma
   * avaliação de conquista roda depois de ações comuns (favoritar, concluir
   * obra) — encadeá-las somaria latência a cada interação.
   */
  async collect(userId: string): Promise<AchievementStats> {
    const recentSince = new Date();
    recentSince.setDate(recentSince.getDate() - RECENT_WINDOW_DAYS);

    const [
      wantToLearn,
      learned,
      favoriteComposers,
      favoriteWorks,
      favoriteScores,
      annotationsCount,
      verifiedAnnotations,
      helpfulVotes,
      contributions,
      recentDiscoveries,
    ] = await Promise.all([
      this.prisma.wantToLearn.findMany({
        where: { userId },
        select: { workId: true, addedAt: true },
      }),
      this.prisma.learned.findMany({
        where: { userId },
        select: {
          workId: true,
          mastery: true,
          learnedAt: true,
          publicPerformance: true,
        },
      }),
      this.prisma.favoriteComposer.findMany({
        where: { userId },
        select: { createdAt: true },
      }),
      this.prisma.favoriteWork.findMany({
        where: { userId },
        select: {
          createdAt: true,
          work: {
            select: {
              composerId: true,
              epochId: true,
              instrumentId: true,
            },
          },
        },
      }),
      this.prisma.favoriteScore.findMany({
        where: { userId },
        select: { addedAt: true },
      }),
      this.prisma.workAnnotation.count({ where: { userId } }),
      this.prisma.workAnnotation.count({
        where: { userId, isVerified: true },
      }),
      this.prisma.annotationHelpfulVote.count({
        where: { annotation: { userId }, isHelpful: true },
      }),
      this.countContributions(userId),
      this.prisma.favoriteWork.count({
        where: { userId, createdAt: { gte: recentSince } },
      }),
    ]);

    const learnedCount = learned.length;
    const wantToLearnCount = wantToLearn.length;

    const masteryValues = learned.map((entry) => entry.mastery);
    const expertLevelCount = masteryValues.filter(
      (mastery) => mastery >= EXPERT_MASTERY,
    ).length;

    const avgMastery =
      masteryValues.length > 0
        ? masteryValues.reduce((sum, value) => sum + value, 0) /
          masteryValues.length
        : 0;

    const totalFavorites =
      favoriteComposers.length + favoriteWorks.length + favoriteScores.length;

    // A sequência considera as três formas de favoritar. Datas ausentes vêm
    // dos favoritos gravados antes de o campo existir: não entram na conta,
    // em vez de serem inventadas.
    const favoriteDates = [
      ...favoriteComposers.map((favorite) => favorite.createdAt),
      ...favoriteWorks.map((favorite) => favorite.createdAt),
      ...favoriteScores.map((favorite) => favorite.addedAt),
    ].filter((date): date is Date => date instanceof Date);

    return {
      wantToLearnCount,
      learnedCount,
      totalLearning: wantToLearnCount + learnedCount,
      expertLevelCount,
      avgMastery,
      completionRate: this.completionRate(wantToLearnCount, learnedCount),
      learningStreak: this.consecutiveDayStreak(
        learned.map((entry) => entry.learnedAt),
      ),

      favoriteComposers: favoriteComposers.length,
      favoriteWorks: favoriteWorks.length,
      favoriteScores: favoriteScores.length,
      totalFavorites,
      epochsCount: this.distinctCount(
        favoriteWorks.map((favorite) => favorite.work?.epochId),
      ),
      instrumentsCount: this.distinctCount(
        favoriteWorks.map((favorite) => favorite.work?.instrumentId),
      ),
      topComposerWorks: this.largestGroup(
        favoriteWorks.map((favorite) => favorite.work?.composerId),
      ),
      favoriteStreak: this.consecutiveDayStreak(favoriteDates),
      recentDiscoveries,

      annotationsCount,
      helpfulVotes,
      verifiedAnnotations,

      publicPerformances: learned.filter((entry) => entry.publicPerformance)
        .length,

      contributions,
    };
  }

  /** Compositores, obras e partituras que o usuário adicionou ao catálogo. */
  private async countContributions(userId: string): Promise<number> {
    const [composers, works, scores] = await Promise.all([
      this.prisma.composer.count({ where: { createdBy: userId } }),
      this.prisma.work.count({ where: { createdBy: userId } }),
      this.prisma.workScore.count({ where: { uploadedBy: userId } }),
    ]);

    return composers + works + scores;
  }

  /**
   * Percentual de obras iniciadas que foram concluídas.
   *
   * O denominador é tudo que o usuário começou — o que está na lista de estudos
   * mais o que já concluiu. Sem nada iniciado, a taxa é 0 e não 100: um usuário
   * novo não é "100% eficiente" por nunca ter tentado nada.
   */
  private completionRate(wantToLearn: number, learned: number): number {
    const started = wantToLearn + learned;

    if (started === 0) {
      return 0;
    }

    return (learned / started) * 100;
  }

  private distinctCount(values: Array<string | null | undefined>): number {
    return new Set(values.filter(Boolean)).size;
  }

  /** Tamanho do maior grupo — quantas obras do compositor mais favoritado. */
  private largestGroup(values: Array<string | null | undefined>): number {
    const counts = new Map<string, number>();

    for (const value of values) {
      if (value) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    return counts.size > 0 ? Math.max(...counts.values()) : 0;
  }

  /**
   * Maior sequência de dias consecutivos com ao menos um evento.
   *
   * Conta dias distintos, não eventos: favoritar cinco obras na segunda-feira é
   * um dia de sequência, não cinco. A comparação é feita em data local, porque
   * "dias seguidos" é o que o usuário vê no calendário dele.
   */
  private consecutiveDayStreak(dates: Date[]): number {
    if (dates.length === 0) {
      return 0;
    }

    const days = [
      ...new Set(
        dates.map((date) => {
          const day = new Date(date);
          day.setHours(0, 0, 0, 0);
          return day.getTime();
        }),
      ),
    ].sort((a, b) => a - b);

    const oneDay = 24 * 60 * 60 * 1000;
    let longest = 1;
    let current = 1;

    for (let index = 1; index < days.length; index++) {
      if (days[index] - days[index - 1] === oneDay) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    return longest;
  }
}
