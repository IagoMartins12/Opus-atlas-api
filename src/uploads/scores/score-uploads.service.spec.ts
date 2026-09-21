import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { StorageService } from '../../common/storage/storage.service';
import { UploadHistoryService } from '../shared/upload-history.service';
import { ScoreUploadsService } from './score-uploads.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

describe('ScoreUploadsService', () => {
  let service: ScoreUploadsService;
  let prisma: {
    work: { findUnique: jest.Mock };
    workScore: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
    storedAsset: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let storage: { deleteByEntity: jest.Mock };
  let history: { record: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

  const activeAsset = {
    id: 'asset-1',
    ownerId: 'user-1',
    status: StorageAssetStatus.ACTIVE,
    kind: StorageAssetKind.SCORE_FILE,
    entityId: null,
    secureUrl: 'https://res.cloudinary.com/opus/image/upload/v1/score.pdf',
    publicId: 'opus/test/scores/work-1/score_file_abc',
    bytes: 204800,
    format: 'pdf',
  };

  const dto = {
    workId: 'work-1',
    title: 'Edição Urtext',
    assetId: 'asset-1',
  };

  beforeEach(async () => {
    prisma = {
      work: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'work-1', title: 'Sonata nº 14' }),
      },
      workScore: {
        create: jest.fn().mockResolvedValue({
          id: 'score-1',
          title: 'Edição Urtext',
          fileFormat: 'PDF',
          type: 'SCORES',
        }),
        update: jest.fn().mockResolvedValue({ id: 'score-1' }),
        delete: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      storedAsset: {
        findUnique: jest.fn().mockResolvedValue(activeAsset),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    storage = { deleteByEntity: jest.fn().mockResolvedValue(0) };
    history = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoreUploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityTracker, useValue: { track: jest.fn() } },
        { provide: UploadHistoryService, useValue: history },
        { provide: StorageService, useValue: storage },
        { provide: AppCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(ScoreUploadsService);
  });

  describe('create', () => {
    it('registra a partitura com a URL do arquivo já enviado', async () => {
      await service.create('user-1', dto, context);

      const data = prisma.workScore.create.mock.calls[0][0].data;

      expect(data.downloadUrl).toBe(activeAsset.secureUrl);
      expect(data.fileSize).toBe('204800');
    });

    // `UPLOAD` é o que separa arquivo nosso dos 92 mil links do IMSLP, e é o
    // que impede uma rotina de limpeza de tentar apagar o que não é nosso.
    it('grava a origem como UPLOAD, distinta do IMSLP', async () => {
      await service.create('user-1', dto, context);

      expect(prisma.workScore.create.mock.calls[0][0].data.source).toBe(
        'UPLOAD',
      );
    });

    // Sem esta checagem, bastaria informar o assetId de outra pessoa para
    // anexar o arquivo dela à própria contribuição.
    it('recusa arquivo enviado por outro usuário', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        ...activeAsset,
        ownerId: 'outro',
      });

      await expect(service.create('user-1', dto, context)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa arquivo cujo envio não foi confirmado', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        ...activeAsset,
        status: StorageAssetStatus.PENDING,
      });

      await expect(service.create('user-1', dto, context)).rejects.toThrow(
        /envio do arquivo ainda não foi concluído/i,
      );
    });

    it('recusa arquivo do tipo errado', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        ...activeAsset,
        kind: StorageAssetKind.PROFILE_IMAGE,
      });

      await expect(service.create('user-1', dto, context)).rejects.toThrow(
        /não é do tipo/i,
      );
    });

    it('recusa arquivo já associado a outro item', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        ...activeAsset,
        entityId: 'score-existente',
      });

      await expect(service.create('user-1', dto, context)).rejects.toThrow(
        /já está associado/i,
      );
    });

    it('recusa obra inexistente', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', dto, context)).rejects.toThrow(
        BadRequestException,
      );
    });

    // Se a criação falhar, o arquivo continua sem dono e a limpeza o recolhe.
    it('associa o arquivo à partitura só depois de criá-la', async () => {
      await service.create('user-1', dto, context);

      const createOrder = prisma.workScore.create.mock.invocationCallOrder[0];
      const attachOrder =
        prisma.storedAsset.updateMany.mock.invocationCallOrder[0];

      expect(createOrder).toBeLessThan(attachOrder);
      expect(prisma.storedAsset.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { entityType: 'workScore', entityId: 'score-1' },
        }),
      );
    });

    it('aceita partitura por link externo, sem arquivo', async () => {
      await service.create(
        'user-1',
        {
          workId: 'work-1',
          title: 'Edição externa',
          externalUrl: 'https://imslp.org/wiki/Special:ImagefromIndex/1',
        },
        context,
      );

      const data = prisma.workScore.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          source: 'CUSTOM',
          downloadUrl: 'https://imslp.org/wiki/Special:ImagefromIndex/1',
          fileSize: null,
        }),
      );
      expect(data.sourceId).toMatch(/^CUSTOM-/);
      expect(prisma.storedAsset.findUnique).not.toHaveBeenCalled();
    });

    it('recusa arquivo e link juntos', async () => {
      await expect(
        service.create(
          'user-1',
          { ...dto, externalUrl: 'https://imslp.org/x.pdf' },
          context,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aceita miniatura opcional', async () => {
      prisma.storedAsset.findUnique
        .mockResolvedValueOnce(activeAsset)
        .mockResolvedValueOnce({
          ...activeAsset,
          id: 'asset-2',
          kind: StorageAssetKind.SCORE_THUMBNAIL,
          secureUrl:
            'https://res.cloudinary.com/opus/image/upload/v1/thumb.jpg',
        });

      await service.create(
        'user-1',
        { ...dto, thumbnailAssetId: 'asset-2' },
        context,
      );

      expect(prisma.workScore.create.mock.calls[0][0].data.thumbnailUrl).toBe(
        'https://res.cloudinary.com/opus/image/upload/v1/thumb.jpg',
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.workScore.findUnique.mockResolvedValue({
        id: 'score-1',
        title: 'Edição Urtext',
        uploadedBy: 'user-1',
        source: 'UPLOAD',
      });
    });

    it('permite ao autor editar os metadados', async () => {
      await expect(
        service.update('user-1', false, 'score-1', { title: 'Novo' }, context),
      ).resolves.toBeDefined();
    });

    it('bloqueia edição de partitura alheia', async () => {
      await expect(
        service.update('outro', false, 'score-1', { title: 'X' }, context),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('remove o arquivo antes do registro', async () => {
      prisma.workScore.findUnique.mockResolvedValue({
        id: 'score-1',
        title: 'Edição Urtext',
        uploadedBy: 'user-1',
        source: 'UPLOAD',
      });

      await service.remove('user-1', false, 'score-1', context);

      const storageOrder = storage.deleteByEntity.mock.invocationCallOrder[0];
      const deleteOrder = prisma.workScore.delete.mock.invocationCallOrder[0];

      expect(storageOrder).toBeLessThan(deleteOrder);
    });
  });
});
