import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { SubscriptionsService } from '../billing/services/subscriptions.service';
import { StorageService } from '../common/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from './uploads.service';

describe('UploadsService', () => {
  let service: UploadsService;
  let prisma: { storedAsset: { findUnique: jest.Mock } };
  let storage: {
    createSignedUpload: jest.Mock;
    confirmUpload: jest.Mock;
    uploadFile: jest.Mock;
    deleteAsset: jest.Mock;
    countActiveByOwner: jest.Mock;
  };
  let subscriptions: { checkFeatureAccess: jest.Mock };

  const asset = {
    id: 'asset-1',
    kind: StorageAssetKind.PERFORMANCE_VIDEO,
    status: StorageAssetStatus.PENDING,
    resourceType: 'VIDEO',
    secureUrl: null,
    format: null,
    bytes: null,
    width: null,
    height: null,
    duration: null,
    createdAt: new Date('2026-09-07T18:00:00Z'),
  };

  beforeEach(async () => {
    prisma = { storedAsset: { findUnique: jest.fn() } };

    storage = {
      createSignedUpload: jest.fn().mockResolvedValue({
        asset,
        upload: {
          uploadUrl: 'https://api.cloudinary.com/v1_1/opus/video/upload',
          apiKey: 'chave',
          timestamp: 1757260800,
          signature: 'assinatura',
          folder: 'opus/test/performances/work-1',
          publicId: 'performance_video_abc',
        },
        maxBytes: 500 * 1024 * 1024,
        allowedMimeTypes: ['video/mp4'],
      }),
      confirmUpload: jest
        .fn()
        .mockResolvedValue({ ...asset, status: StorageAssetStatus.ACTIVE }),
      uploadFile: jest
        .fn()
        .mockResolvedValue({ ...asset, status: StorageAssetStatus.ACTIVE }),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
      countActiveByOwner: jest.fn().mockResolvedValue(0),
    };

    subscriptions = {
      checkFeatureAccess: jest
        .fn()
        .mockResolvedValue({ plan: 'FREE', hasAccess: true, limit: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get(UploadsService);
  });

  describe('limite por plano (RN-1)', () => {
    it('libera quando o usuário está abaixo do limite', async () => {
      storage.countActiveByOwner.mockResolvedValue(2);

      await expect(
        service.createSignedUpload('user-1', {
          kind: StorageAssetKind.PERFORMANCE_VIDEO,
          scopeId: 'work1',
        }),
      ).resolves.toBeDefined();
    });

    it('bloqueia ao atingir o limite do plano', async () => {
      storage.countActiveByOwner.mockResolvedValue(3);

      await expect(
        service.createSignedUpload('user-1', {
          kind: StorageAssetKind.PERFORMANCE_VIDEO,
          scopeId: 'work1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Barrar só na confirmação faria o usuário gastar a banda dele e a cota do
    // provedor com 500MB de vídeo antes de descobrir que não podia enviar.
    it('checa o limite antes de reservar espaço no armazenamento', async () => {
      storage.countActiveByOwner.mockResolvedValue(3);

      await expect(
        service.createSignedUpload('user-1', {
          kind: StorageAssetKind.PERFORMANCE_VIDEO,
          scopeId: 'work1',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(storage.createSignedUpload).not.toHaveBeenCalled();
    });

    it('usa maxPerformanceVideos para vídeo de performance', async () => {
      await service.createSignedUpload('user-1', {
        kind: StorageAssetKind.PERFORMANCE_VIDEO,
        scopeId: 'work1',
      });

      expect(subscriptions.checkFeatureAccess).toHaveBeenCalledWith(
        'user-1',
        'maxPerformanceVideos',
      );
    });

    it('usa uploadLimit para envio de partitura', async () => {
      await service.uploadFile('user-1', StorageAssetKind.SCORE_FILE, 'work1', {
        buffer: Buffer.alloc(4),
        originalName: 'p.pdf',
        size: 4,
      });

      expect(subscriptions.checkFeatureAccess).toHaveBeenCalledWith(
        'user-1',
        'uploadLimit',
      );
    });

    it('não consulta plano para tipo sem limite, como avatar', async () => {
      await service.uploadFile(
        'user-1',
        StorageAssetKind.PROFILE_IMAGE,
        'user1',
        { buffer: Buffer.alloc(4), originalName: 'f.png', size: 4 },
      );

      expect(subscriptions.checkFeatureAccess).not.toHaveBeenCalled();
    });

    it('trata plano sem limite numérico como ilimitado', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MAESTRO',
        hasAccess: true,
        limit: undefined,
      });
      storage.countActiveByOwner.mockResolvedValue(999);

      await expect(
        service.createSignedUpload('user-1', {
          kind: StorageAssetKind.PERFORMANCE_VIDEO,
          scopeId: 'work1',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('dono do arquivo enviado', () => {
    const file = { buffer: Buffer.alloc(4), originalName: 'f.pdf', size: 4 };

    // A criação da partitura adota o arquivo e recusa o que já tem dono: com o
    // `scopeId` como dono, nenhuma partitura enviada por aqui era criada.
    it.each([StorageAssetKind.SCORE_FILE, StorageAssetKind.SCORE_THUMBNAIL])(
      '%s sobe sem dono, para a partitura adotar',
      async (kind) => {
        await service.uploadFile('user-1', kind, 'work1', file);

        expect(storage.uploadFile).toHaveBeenCalledWith(
          expect.objectContaining({
            kind,
            scopeId: 'work1',
            entityId: undefined,
          }),
          file,
        );
      },
    );

    it('retrato do compositor fica com o compositor como dono', async () => {
      await service.uploadFile(
        'user-1',
        StorageAssetKind.COMPOSER_IMAGE,
        'composer1',
        file,
      );

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'composer1' }),
        file,
      );
    });
  });

  describe('createSignedUpload', () => {
    it('devolve os campos da assinatura para o cliente reenviar', async () => {
      const result = await service.createSignedUpload('user-1', {
        kind: StorageAssetKind.PERFORMANCE_VIDEO,
        scopeId: 'work1',
      });

      expect(result.fields).toEqual({
        api_key: 'chave',
        timestamp: 1757260800,
        signature: 'assinatura',
        folder: 'opus/test/performances/work-1',
        public_id: 'performance_video_abc',
      });
    });

    // As tags entram na assinatura; sem elas no reenvio o Cloudinary responde
    // "Invalid Signature" — era o que acontecia com todo envio direto.
    it('devolve as tags assinadas junto com os outros campos', async () => {
      const signed =
        await storage.createSignedUpload.getMockImplementation()!();
      storage.createSignedUpload.mockResolvedValueOnce({
        ...signed,
        upload: { ...signed.upload, tags: 'work_audio,work1' },
      });

      const result = await service.createSignedUpload('user-1', {
        kind: StorageAssetKind.WORK_AUDIO,
        scopeId: 'work1',
      });

      expect(result.fields).toMatchObject({
        tags: 'work_audio,work1',
        signature: 'assinatura',
      });
    });

    it('associa o arquivo à entidade correta', async () => {
      await service.createSignedUpload('user-1', {
        kind: StorageAssetKind.ASSIGNMENT_VIDEO,
        scopeId: 'tarefa1',
      });

      expect(storage.createSignedUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'assignment',
          entityId: 'tarefa1',
          ownerId: 'user-1',
        }),
      );
    });
  });

  describe('deleteOwnAsset', () => {
    it('remove o arquivo do próprio usuário', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        ownerId: 'user-1',
        status: StorageAssetStatus.ACTIVE,
      });

      await service.deleteOwnAsset('user-1', 'asset-1');

      expect(storage.deleteAsset).toHaveBeenCalledWith('asset-1');
    });

    // 404 em vez de 403: responder "existe, mas não é seu" confirmaria a
    // existência do id para quem está sondando.
    it('responde não encontrado para arquivo de outro usuário', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        ownerId: 'outro',
        status: StorageAssetStatus.ACTIVE,
      });

      await expect(service.deleteOwnAsset('user-1', 'asset-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(storage.deleteAsset).not.toHaveBeenCalled();
    });

    it('é idempotente para arquivo já removido', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        ownerId: 'user-1',
        status: StorageAssetStatus.DELETED,
      });

      await service.deleteOwnAsset('user-1', 'asset-1');

      expect(storage.deleteAsset).not.toHaveBeenCalled();
    });
  });
});
