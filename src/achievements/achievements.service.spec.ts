import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementStats } from './achievement-catalog';
import { AchievementStatsService } from './achievement-stats.service';
import { AchievementsService } from './achievements.service';

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

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('AchievementsService', () => {
  let service: AchievementsService;
  let prisma: {
    userAchievement: { findMany: jest.Mock; updateMany: jest.Mock };
    achievementProgress: { upsert: jest.Mock };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let statsService: { collect: jest.Mock };
  let tx: {
    userAchievement: { create: jest.Mock };
    user: { update: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      userAchievement: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      userAchievement: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      achievementProgress: { upsert: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ totalXP: 0 }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    statsService = { collect: jest.fn().mockResolvedValue(emptyStats()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AchievementStatsService, useValue: statsService },
      ],
    }).compile();

    service = module.get(AchievementsService);
  });

  describe('evaluate', () => {
    it('não concede nada para usuário sem atividade', async () => {
      const granted = await service.evaluate('user-1');

      expect(granted).toEqual([]);
      expect(tx.userAchievement.create).not.toHaveBeenCalled();
    });

    it('concede o badge quando a métrica atinge o limiar', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 1,
      });

      const granted = await service.evaluate('user-1');

      expect(granted.map((badge) => badge.badgeId)).toContain('first-favorite');
    });

    // No legado, apenas a categoria LEARNING creditava XP; badges de favoritos
    // e anotações eram gravados com `xpReward` mas nunca somavam nada.
    it('credita XP em todas as categorias', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 1,
        annotationsCount: 1,
        totalLearning: 1,
      });

      await service.evaluate('user-1');

      const creditedCategories = tx.userAchievement.create.mock.calls.map(
        (call: [{ data: { category: string } }]) => call[0].data.category,
      );

      expect(new Set(creditedCategories).size).toBeGreaterThan(1);
      expect(tx.user.update).toHaveBeenCalledTimes(
        tx.userAchievement.create.mock.calls.length,
      );
    });

    // A criação e o crédito acontecem na mesma transação, então não há janela
    // em que o XP suba sem o badge existir.
    it('cria o badge e credita o XP na mesma transação', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 1,
      });

      await service.evaluate('user-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { totalXP: { increment: 10 } },
        }),
      );
    });

    it('não reconcede badge que o usuário já tem', async () => {
      prisma.userAchievement.findMany.mockResolvedValue([
        { badgeId: 'first-favorite' },
      ]);
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 1,
      });

      const granted = await service.evaluate('user-1');

      expect(granted.map((badge) => badge.badgeId)).not.toContain(
        'first-favorite',
      );
    });

    // Duas avaliações simultâneas: o índice único resolve, e quem perde a
    // corrida não credita XP de novo.
    it('não credita em dobro quando duas avaliações correm juntas', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 1,
      });
      tx.userAchievement.create.mockRejectedValue(uniqueViolation());

      const granted = await service.evaluate('user-1');

      expect(granted).toEqual([]);
    });

    it('concede vários badges de uma vez quando o limiar de todos foi atingido', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 100,
      });

      const granted = await service.evaluate('user-1');
      const ids = granted.map((badge) => badge.badgeId);

      expect(ids).toEqual(
        expect.arrayContaining([
          'first-favorite',
          'collector-bronze',
          'collector-silver',
          'collector-gold',
        ]),
      );
    });

    // O modelo existia no schema e nunca era escrito pela verificação — só por
    // uma rota que aceitava o valor direto do cliente.
    it('grava o progresso dos badges ainda bloqueados', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 37,
      });

      await service.evaluate('user-1');

      expect(prisma.achievementProgress.upsert).toHaveBeenCalled();
    });

    it('não interrompe a avaliação quando um badge falha', async () => {
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 100,
      });
      tx.userAchievement.create
        .mockRejectedValueOnce(new Error('banco fora'))
        .mockResolvedValue({});

      const granted = await service.evaluate('user-1');

      expect(granted.length).toBeGreaterThan(0);
    });
  });

  describe('statsForUser', () => {
    it('calcula o nível a partir do XP acumulado', async () => {
      prisma.user.findUnique.mockResolvedValue({ totalXP: 285 });
      prisma.userAchievement.findMany.mockResolvedValue([
        { rarity: 'COMMON', category: 'LEARNING' },
        { rarity: 'RARE', category: 'FAVORITES' },
      ]);

      const stats = await service.statsForUser('user-1');

      expect(stats.level).toBe(3);
      expect(stats.xpIntoLevel).toBe(85);
      expect(stats.xpToNextLevel).toBe(15);
    });

    it('começa no nível 1 com zero XP', async () => {
      const stats = await service.statsForUser('user-1');

      expect(stats.level).toBe(1);
      expect(stats.totalXP).toBe(0);
    });

    it('agrupa as conquistas por raridade e categoria', async () => {
      prisma.userAchievement.findMany.mockResolvedValue([
        { rarity: 'COMMON', category: 'LEARNING' },
        { rarity: 'COMMON', category: 'FAVORITES' },
        { rarity: 'EPIC', category: 'FAVORITES' },
      ]);

      const stats = await service.statsForUser('user-1');

      expect(stats.byRarity).toEqual({ COMMON: 2, EPIC: 1 });
      expect(stats.byCategory).toEqual({ LEARNING: 1, FAVORITES: 2 });
    });

    it('responde 404 para usuário inexistente', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.statsForUser('sumiu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listForUser', () => {
    it('separa conquistadas de pendentes com percentual', async () => {
      prisma.userAchievement.findMany.mockResolvedValue([
        {
          badgeId: 'first-favorite',
          name: 'Primeiro Favorito',
          description: 'x',
          category: 'MILESTONE',
          rarity: 'COMMON',
          xpReward: 10,
          isNew: true,
          unlockedAt: new Date(),
        },
      ]);
      statsService.collect.mockResolvedValue({
        ...emptyStats(),
        totalFavorites: 5,
      });

      const result = await service.listForUser('user-1');

      expect(result.unlocked).toHaveLength(1);
      expect(result.summary.newCount).toBe(1);

      const bronze = result.locked.find(
        (badge) => badge.badgeId === 'collector-bronze',
      );

      expect(bronze?.percentage).toBe(50);
    });
  });

  describe('markAsViewed', () => {
    it('marca a conquista como vista', async () => {
      await service.markAsViewed('user-1', 'first-goal');

      expect(prisma.userAchievement.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isNew: false }),
        }),
      );
    });

    // Sem validar contra o catálogo, um id inventado gastaria uma escrita.
    it('recusa badgeId fora do catálogo sem tocar no banco', async () => {
      await expect(
        service.markAsViewed('user-1', 'badge-inventado'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.userAchievement.updateMany).not.toHaveBeenCalled();
    });

    it('responde 404 quando o usuário não tem a conquista', async () => {
      prisma.userAchievement.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markAsViewed('user-1', 'first-goal'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('catalog', () => {
    it('expõe o catálogo sem dado de usuário', () => {
      const catalog = service.catalog();

      expect(catalog.total).toBe(catalog.achievements.length);
      expect(catalog.achievements[0]).not.toHaveProperty('isNew');
      expect(catalog.achievements[0]).not.toHaveProperty('progress');
    });
  });
});
