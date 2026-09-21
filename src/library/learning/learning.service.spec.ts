import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { LearningService } from './learning.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';
import { StorageService } from '../../common/storage/storage.service';

describe('LearningService', () => {
  let service: LearningService;
  let prisma: any;
  let storage: { deleteAsset: jest.Mock };

  beforeEach(async () => {
    prisma = {
      work: { findUnique: jest.fn() },
      workScore: { findFirst: jest.fn() },
      storedAsset: { findUnique: jest.fn(), findFirst: jest.fn() },
      wantToLearn: {
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      learned: {
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    storage = { deleteAsset: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityTracker, useValue: { track: jest.fn() } },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(LearningService);
  });

  describe('addOrRemoveWantToLearn', () => {
    it('lança 404 quando a obra não existe', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(
        service.addOrRemoveWantToLearn('user-1', {
          workId: 'w1',
          action: 'add',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ao adicionar, remove da lista de aprendidas (exclusão mútua) e calcula progresso', async () => {
      prisma.work.findUnique.mockResolvedValue({
        id: 'w1',
        instrument: { name: 'piano' },
      });
      prisma.learned.deleteMany.mockResolvedValue({ count: 1 });
      prisma.wantToLearn.upsert.mockResolvedValue({
        id: 'wtl-1',
        userId: 'user-1',
        workId: 'w1',
        progress: 30,
        work: { id: 'w1', title: 'Sonata', composer: {} },
      });

      const result = await service.addOrRemoveWantToLearn('user-1', {
        workId: 'w1',
        action: 'add',
        progressMilestones: { learnedLeftHand: true, learnedRightHand: true },
      } as any);

      expect(prisma.learned.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', workId: 'w1' },
      });
      expect(result).toEqual({
        success: true,
        action: 'added',
        item: expect.any(Object),
      });
      // learnedLeftHand (15) + learnedRightHand (15) = 30 para piano
      expect(prisma.wantToLearn.upsert.mock.calls[0][0].update.progress).toBe(
        30,
      );
    });

    it('rejeita workScore que não pertence à obra', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1', instrument: null });
      prisma.workScore.findFirst.mockResolvedValue(null);

      await expect(
        service.addOrRemoveWantToLearn('user-1', {
          workId: 'w1',
          action: 'add',
          selectedWorkScoreId: 'score-x',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('remove sem tocar na lista de aprendidas', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.wantToLearn.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.addOrRemoveWantToLearn('user-1', {
        workId: 'w1',
        action: 'remove',
      } as any);

      expect(result).toEqual({ success: true, action: 'removed' });
      expect(prisma.learned.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('addOrRemoveLearned', () => {
    it('ao adicionar, remove da lista de quero-aprender (exclusão mútua)', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.wantToLearn.deleteMany.mockResolvedValue({ count: 1 });
      prisma.learned.upsert.mockResolvedValue({
        id: 'l1',
        userId: 'user-1',
        workId: 'w1',
        work: { id: 'w1', title: 'Sonata', composer: {} },
      });

      const result = await service.addOrRemoveLearned('user-1', {
        workId: 'w1',
        action: 'add',
        mastery: 3,
      } as any);

      expect(prisma.wantToLearn.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', workId: 'w1' },
      });
      expect(result.action).toBe('added');
    });

    it('lança 404 quando a obra não existe', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(
        service.addOrRemoveLearned('user-1', {
          workId: 'w1',
          action: 'add',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('vídeo de performance', () => {
    const asset = {
      ownerId: 'user-1',
      kind: 'PERFORMANCE_VIDEO',
      status: 'ACTIVE',
      secureUrl: 'https://res.cloudinary.com/opus/video/upload/perf.mp4',
      bytes: 1000,
    };

    it('ao adicionar com vídeo, grava a URL do arquivo confirmado', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.learned.findFirst.mockResolvedValue(null);
      prisma.storedAsset.findUnique.mockResolvedValue(asset);
      prisma.learned.upsert.mockResolvedValue({ id: 'l1' });

      await service.addOrRemoveLearned('user-1', {
        workId: 'w1',
        action: 'add',
        videoAssetId: 'a1',
        videoFileName: 'perf.mp4',
        isVideoPublic: true,
      } as any);

      expect(prisma.learned.upsert.mock.calls[0][0].create).toEqual(
        expect.objectContaining({
          videoUrl: asset.secureUrl,
          videoFileName: 'perf.mp4',
          videoFileSize: 1000,
          isVideoPublic: true,
        }),
      );
    });

    it('recusa vídeo de outra conta ou com o envio não confirmado', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.learned.findFirst.mockResolvedValue(null);
      const add = () =>
        service.addOrRemoveLearned('user-1', {
          workId: 'w1',
          action: 'add',
          videoAssetId: 'a1',
        } as any);

      prisma.storedAsset.findUnique.mockResolvedValue({
        ...asset,
        ownerId: 'outra',
      });
      await expect(add()).rejects.toBeInstanceOf(BadRequestException);

      prisma.storedAsset.findUnique.mockResolvedValue({
        ...asset,
        status: 'PENDING',
      });
      await expect(add()).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.learned.upsert).not.toHaveBeenCalled();
    });

    it('tirar o vídeo zera os campos e apaga o arquivo', async () => {
      prisma.learned.findFirst
        .mockResolvedValueOnce({ id: 'l1', videoUrl: asset.secureUrl })
        .mockResolvedValueOnce({ id: 'l1' });
      prisma.learned.updateMany.mockResolvedValue({ count: 1 });
      prisma.storedAsset.findFirst.mockResolvedValue({ id: 'a1' });

      await service.updateLearned('user-1', {
        workId: 'w1',
        removeVideo: true,
      } as any);

      expect(prisma.learned.updateMany.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ videoUrl: null, isVideoPublic: false }),
      );
      expect(storage.deleteAsset).toHaveBeenCalledWith('a1');
    });

    it('tirar a obra da lista apaga o vídeo dela', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.learned.findFirst.mockResolvedValue({ videoUrl: asset.secureUrl });
      prisma.storedAsset.findFirst.mockResolvedValue({ id: 'a1' });

      await service.addOrRemoveLearned('user-1', {
        workId: 'w1',
        action: 'remove',
      } as any);

      expect(prisma.learned.deleteMany).toHaveBeenCalled();
      expect(storage.deleteAsset).toHaveBeenCalledWith('a1');
    });
  });

  describe('updateLearned', () => {
    it('lança 404 quando o item não existe', async () => {
      prisma.learned.findFirst.mockResolvedValue(null);

      await expect(
        service.updateLearned('user-1', { workId: 'w1', mastery: 5 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
