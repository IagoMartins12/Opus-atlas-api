import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AnnotationsService } from './annotations.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

describe('AnnotationsService', () => {
  let service: AnnotationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      work: { findUnique: jest.fn(), update: jest.fn() },
      user: { update: jest.fn() },
      workAnnotation: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      annotationHelpfulVote: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnotationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityTracker, useValue: { track: jest.fn() } },
      ],
    }).compile();

    service = module.get(AnnotationsService);
  });

  describe('create', () => {
    it('lança 404 quando a obra não existe', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          workId: 'w1',
          title: 'x',
          content: 'y',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cria a anotação e incrementa os contadores', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'w1' });
      prisma.workAnnotation.create.mockResolvedValue({
        id: 'a1',
        userId: 'user-1',
        workId: 'w1',
        title: 'Título',
        content: 'Conteúdo',
        user: {},
        work: {},
        _count: { helpfulVotes: 0 },
      });

      const result = await service.create('user-1', {
        workId: 'w1',
        title: '  Título  ',
        content: '  Conteúdo  ',
        tags: ['a', ' ', 'b'],
      } as any);

      expect(result.annotation.userVote).toBeNull();
      expect(prisma.work.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1' },
          data: expect.objectContaining({ annotationsCount: { increment: 1 } }),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
    });
  });

  describe('findOne', () => {
    it('lança 404 para anotação privada quando o chamador não é o autor', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: false,
      });

      await expect(
        service.findOne('a1', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('permite o autor ver a própria anotação privada', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: false,
        viewCount: 0,
      });
      prisma.annotationHelpfulVote.findUnique.mockResolvedValue(null);
      prisma.workAnnotation.update.mockResolvedValue({});

      const result = await service.findOne('a1', 'owner');

      expect(result.annotation.userVote).toBeNull();
    });
  });

  describe('update / remove', () => {
    it('update lança 404 quando o chamador não é o autor', async () => {
      prisma.workAnnotation.findFirst.mockResolvedValue(null);

      await expect(
        service.update('a1', 'not-owner', { title: 'x' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove lança 404 quando o chamador não é o autor', async () => {
      prisma.workAnnotation.findFirst.mockResolvedValue(null);

      await expect(service.remove('a1', 'not-owner')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('remove decrementa contadores da obra e do usuário', async () => {
      prisma.workAnnotation.findFirst.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        workId: 'w1',
      });
      prisma.workAnnotation.delete.mockResolvedValue({});

      await service.remove('a1', 'owner');

      expect(prisma.work.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'w1' },
          data: { annotationsCount: { decrement: 1 } },
        }),
      );
    });
  });

  describe('vote', () => {
    it('rejeita voto na própria anotação', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'user-1',
        isPublic: true,
      });

      await expect(service.vote('a1', 'user-1', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejeita voto em anotação privada', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: false,
      });

      await expect(service.vote('a1', 'voter', true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('primeiro voto útil incrementa helpfulCount', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: true,
      });
      prisma.annotationHelpfulVote.findUnique.mockResolvedValue(null);
      prisma.workAnnotation.update.mockResolvedValue({ helpfulCount: 1 });

      const result = await service.vote('a1', 'voter', true);

      expect(prisma.annotationHelpfulVote.create).toHaveBeenCalled();
      expect(prisma.workAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { helpfulCount: { increment: 1 } } }),
      );
      expect(result).toEqual({
        success: true,
        userVote: true,
        helpfulCount: 1,
      });
    });

    it('votar de novo com o mesmo valor desfaz o voto', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: true,
      });
      prisma.annotationHelpfulVote.findUnique.mockResolvedValue({
        isHelpful: true,
      });
      prisma.workAnnotation.update.mockResolvedValue({ helpfulCount: 0 });

      const result = await service.vote('a1', 'voter', true);

      expect(prisma.annotationHelpfulVote.delete).toHaveBeenCalled();
      expect(prisma.workAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { helpfulCount: { increment: -1 } } }),
      );
      expect(result.userVote).toBeNull();
    });

    it('trocar de não-útil para útil incrementa em +1', async () => {
      prisma.workAnnotation.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'owner',
        isPublic: true,
      });
      prisma.annotationHelpfulVote.findUnique.mockResolvedValue({
        isHelpful: false,
      });
      prisma.workAnnotation.update.mockResolvedValue({ helpfulCount: 1 });

      const result = await service.vote('a1', 'voter', true);

      expect(prisma.annotationHelpfulVote.update).toHaveBeenCalled();
      expect(prisma.workAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { helpfulCount: { increment: 1 } } }),
      );
      expect(result.userVote).toBe(true);
    });
  });
});
