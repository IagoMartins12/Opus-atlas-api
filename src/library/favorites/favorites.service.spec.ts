import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ScoreSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FavoritesService } from './favorites.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

describe('FavoritesService', () => {
  let service: FavoritesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      composer: { findUnique: jest.fn() },
      work: { findUnique: jest.fn() },
      favoriteComposer: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      favoriteWork: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      favoriteScore: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoritesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityTracker, useValue: { track: jest.fn() } },
      ],
    }).compile();

    service = module.get(FavoritesService);
  });

  describe('toggleComposerFavorite', () => {
    it('lança 404 quando o compositor não existe', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(
        service.toggleComposerFavorite('user-1', {
          composerId: 'c1',
          action: 'add',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('adiciona via upsert e retorna o favorito', async () => {
      prisma.composer.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.favoriteComposer.upsert.mockResolvedValue({
        id: 'fav-1',
        userId: 'user-1',
        composerId: 'c1',
        composer: { id: 'c1', name: 'Bach' },
      });

      const result = await service.toggleComposerFavorite('user-1', {
        composerId: 'c1',
        action: 'add',
      });

      expect(result).toEqual({
        success: true,
        action: 'added',
        favorite: expect.objectContaining({ composerId: 'c1' }),
      });
    });

    it('remove via deleteMany', async () => {
      prisma.composer.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.favoriteComposer.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.toggleComposerFavorite('user-1', {
        composerId: 'c1',
        action: 'remove',
      });

      expect(result).toEqual({ success: true, action: 'removed' });
      expect(prisma.favoriteComposer.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', composerId: 'c1' },
      });
    });
  });

  describe('toggleWorkFavorite', () => {
    it('lança 404 quando a obra não existe', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(
        service.toggleWorkFavorite('user-1', { workId: 'w1', action: 'add' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('toggleScoreFavorite', () => {
    it('exige scoreData ao adicionar', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });

      await expect(
        service.toggleScoreFavorite('user-1', {
          workId: 'w1',
          scoreId: 's1',
          action: 'add',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('adiciona com scoreData válido', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.favoriteScore.upsert.mockResolvedValue({
        id: 'fs1',
        userId: 'user-1',
        workId: 'w1',
        scoreId: 's1',
        scoreSource: ScoreSource.IMSLP,
        scoreTitle: 'Sonata',
        scoreType: 'SCORES',
        personalRating: null,
        notes: null,
        tags: [],
        addedAt: new Date(),
        work: { id: 'w1', title: 'Sonata', composer: { name: 'Bach' } },
      });

      const result = await service.toggleScoreFavorite('user-1', {
        workId: 'w1',
        scoreId: 's1',
        action: 'add',
        scoreData: { title: 'Sonata' },
      } as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('added');
    });

    it('lança 404 ao atualizar um favorito inexistente', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.favoriteScore.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.toggleScoreFavorite('user-1', {
          workId: 'w1',
          scoreId: 's1',
          action: 'update',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getWorkScoreStats', () => {
    it('agrupa favoritos por partitura e calcula a média de avaliação', async () => {
      prisma.favoriteScore.findMany.mockResolvedValue([
        {
          scoreId: 's1',
          scoreSource: ScoreSource.IMSLP,
          scoreTitle: 'Sonata',
          scoreType: 'SCORES',
          downloadUrl: null,
          personalRating: 4,
        },
        {
          scoreId: 's1',
          scoreSource: ScoreSource.IMSLP,
          scoreTitle: 'Sonata',
          scoreType: 'SCORES',
          downloadUrl: null,
          personalRating: 2,
        },
        {
          scoreId: 's2',
          scoreSource: ScoreSource.IMSLP,
          scoreTitle: 'Nocturne',
          scoreType: 'SCORES',
          downloadUrl: null,
          personalRating: null,
        },
      ]);

      const stats = await service.getWorkScoreStats('w1');

      expect(stats.totalFavorites).toBe(3);
      expect(stats.totalScores).toBe(2);
      expect(stats.mostFavorited).toMatchObject({
        scoreId: 's1',
        totalFavorites: 2,
        avgRating: 3,
      });
    });

    it('retorna vazio quando não há favoritos', async () => {
      prisma.favoriteScore.findMany.mockResolvedValue([]);

      const stats = await service.getWorkScoreStats('w1');

      expect(stats).toEqual({
        totalFavorites: 0,
        totalScores: 0,
        mostFavorited: null,
        topScores: [],
      });
    });
  });
});
