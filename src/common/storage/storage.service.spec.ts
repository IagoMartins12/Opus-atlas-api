import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';
import { StorageService } from './storage.service';

const pngBuffer = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x00),
  ]);

const mp4Buffer = () =>
  Buffer.concat([
    Buffer.alloc(4, 0x00),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.alloc(64, 0x00),
  ]);

describe('StorageService', () => {
  let service: StorageService;
  let prisma: {
    storedAsset: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };
  let cloudinary: {
    uploadBuffer: jest.Mock;
    createSignedUpload: jest.Mock;
    getAsset: jest.Mock;
    deleteAsset: jest.Mock;
    buildUrl: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      storedAsset: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'asset-1', ...args.data }),
        ),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'asset-1', ...args.data }),
        ),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    cloudinary = {
      uploadBuffer: jest.fn().mockResolvedValue({
        publicId: 'opus/test/profiles/user-1/profile_image_abc',
        secureUrl: 'https://res.cloudinary.com/opus/image/upload/v1/x.png',
        format: 'png',
        bytes: 1024,
        width: 200,
        height: 200,
        resourceType: 'image',
      }),
      createSignedUpload: jest.fn().mockReturnValue({
        timestamp: 1757260800,
        signature: 'assinatura',
        apiKey: 'chave',
        cloudName: 'opus',
        folder: 'opus/test/performances/work-1',
        publicId: 'performance_video_abc',
        resourceType: 'video',
        uploadUrl: 'https://api.cloudinary.com/v1_1/opus/video/upload',
      }),
      getAsset: jest.fn(),
      deleteAsset: jest.fn().mockResolvedValue(true),
      buildUrl: jest.fn().mockReturnValue('https://cdn/x'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloudinaryService, useValue: cloudinary },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) =>
              key === 'app.nodeEnv' ? 'test' : (fallback ?? 'test'),
          },
        },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  describe('buildFolder', () => {
    // Dev e produção compartilham a mesma conta: sem o prefixo de ambiente, um
    // teste local sobrescreveria arquivo de produção.
    it('inclui o ambiente na raiz', () => {
      expect(
        service.buildFolder(StorageAssetKind.PROFILE_IMAGE, 'user-1'),
      ).toBe('opus/test/profiles/user-1');
    });

    it('usa o segmento definido na política de cada tipo', () => {
      expect(
        service.buildFolder(StorageAssetKind.PERFORMANCE_VIDEO, 'work-1'),
      ).toBe('opus/test/performances/work-1');
    });

    // O escopo é concatenado no caminho: barra e ponto-ponto permitiriam
    // escrever fora da pasta pretendida.
    it('remove caracteres de travessia de caminho do escopo', () => {
      expect(
        service.buildFolder(StorageAssetKind.PROFILE_IMAGE, '../../etc/passwd'),
      ).toBe('opus/test/profiles/etcpasswd');
    });
  });

  describe('uploadFile', () => {
    const target = {
      kind: StorageAssetKind.PROFILE_IMAGE,
      scopeId: 'user-1',
      entityType: 'user',
      entityId: 'user-1',
      ownerId: 'user-1',
    };

    it('envia e registra o arquivo como ativo', async () => {
      const asset = await service.uploadFile(target, {
        buffer: pngBuffer(),
        originalName: 'foto.png',
        size: 1024,
      });

      expect(cloudinary.uploadBuffer).toHaveBeenCalled();
      expect(asset.status).toBe(StorageAssetStatus.ACTIVE);
    });

    it('recusa arquivo acima do limite do tipo', async () => {
      await expect(
        service.uploadFile(target, {
          buffer: pngBuffer(),
          originalName: 'foto.png',
          size: 10 * 1024 * 1024,
        }),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(cloudinary.uploadBuffer).not.toHaveBeenCalled();
    });

    // A validação é pelos bytes: extensão e Content-Type vêm do cliente.
    it('recusa arquivo cujo conteúdo não bate com o tipo permitido', async () => {
      await expect(
        service.uploadFile(target, {
          buffer: Buffer.from('%PDF-1.7 conteúdo', 'ascii'),
          originalName: 'foto.png',
          size: 100,
        }),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('recusa arquivo de tipo irreconhecível', async () => {
      await expect(
        service.uploadFile(target, {
          buffer: Buffer.from('MZ executável', 'ascii'),
          originalName: 'foto.png',
          size: 100,
        }),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('recusa tipo cuja política exige upload assinado', async () => {
      await expect(
        service.uploadFile(
          { ...target, kind: StorageAssetKind.PERFORMANCE_VIDEO },
          { buffer: mp4Buffer(), originalName: 'v.mp4', size: 1024 },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // Avatar só admite um por usuário; o anterior tem de sair.
    it('remove o arquivo anterior quando o tipo substitui', async () => {
      prisma.storedAsset.findMany.mockResolvedValueOnce([{ id: 'antigo-1' }]);
      prisma.storedAsset.findUnique.mockResolvedValueOnce({
        id: 'antigo-1',
        publicId: 'antigo',
        resourceType: 'IMAGE',
        status: StorageAssetStatus.ACTIVE,
      });

      await service.uploadFile(target, {
        buffer: pngBuffer(),
        originalName: 'foto.png',
        size: 1024,
      });

      expect(cloudinary.deleteAsset).toHaveBeenCalledWith('antigo', 'IMAGE');
    });
  });

  describe('createSignedUpload', () => {
    const target = {
      kind: StorageAssetKind.PERFORMANCE_VIDEO,
      scopeId: 'work-1',
      ownerId: 'user-1',
    };

    it('reserva o destino como pendente antes do envio', async () => {
      const result = await service.createSignedUpload(target);

      expect(result.asset.status).toBe(StorageAssetStatus.PENDING);
      expect(result.upload.signature).toBe('assinatura');
    });

    // O provedor prefixa a pasta ao id final. Guardar o valor já prefixado é o
    // que permite consultar e apagar o arquivo depois sem remontar o caminho.
    it('grava o publicId já com a pasta, como o provedor o devolverá', async () => {
      await service.createSignedUpload(target);

      expect(prisma.storedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicId: expect.stringMatching(
              /^opus\/test\/performances\/work-1\/performance_video_[0-9a-f-]{36}$/,
            ),
          }),
        }),
      );
    });

    // O nome original nunca vira nome no provedor: além de colidir, costuma
    // carregar dado pessoal que acabaria exposto na URL pública.
    it('gera um nome opaco e único a cada reserva', async () => {
      await service.createSignedUpload(target);
      await service.createSignedUpload(target);

      const [first, second] = prisma.storedAsset.create.mock.calls.map(
        (call: [{ data: { publicId: string } }]) => call[0].data.publicId,
      );

      expect(first).not.toBe(second);
    });

    it('recusa tipo que deve passar pela API', async () => {
      await expect(
        service.createSignedUpload({
          ...target,
          kind: StorageAssetKind.PROFILE_IMAGE,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmUpload', () => {
    const pending = {
      id: 'asset-1',
      publicId: 'opus/test/performances/work-1/v',
      resourceType: 'VIDEO',
      kind: StorageAssetKind.PERFORMANCE_VIDEO,
      status: StorageAssetStatus.PENDING,
      ownerId: 'user-1',
      entityType: 'work',
      entityId: 'work-1',
    };

    it('confirma quando o arquivo existe no provedor', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue(pending);
      cloudinary.getAsset.mockResolvedValue({
        publicId: pending.publicId,
        secureUrl: 'https://res.cloudinary.com/opus/video/upload/v1/v.mp4',
        bytes: 2048,
        duration: 90,
        resourceType: 'video',
      });

      const asset = await service.confirmUpload('asset-1', 'user-1');

      expect(asset.status).toBe(StorageAssetStatus.ACTIVE);
    });

    // Sem consultar o provedor, bastaria chamar a confirmação sem ter enviado
    // nada para o banco passar a apontar para um arquivo inexistente.
    it('recusa confirmação quando o arquivo não chegou ao provedor', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue(pending);
      cloudinary.getAsset.mockResolvedValue(null);

      await expect(service.confirmUpload('asset-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    // No envio direto o servidor não vê os bytes; esta é a única chance de
    // recusar um arquivo grande demais.
    it('remove do provedor o arquivo que excede o limite', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue(pending);
      cloudinary.getAsset.mockResolvedValue({
        publicId: pending.publicId,
        secureUrl: 'https://cdn/v.mp4',
        bytes: 600 * 1024 * 1024,
        resourceType: 'video',
      });

      await expect(service.confirmUpload('asset-1', 'user-1')).rejects.toThrow(
        PayloadTooLargeException,
      );

      expect(cloudinary.deleteAsset).toHaveBeenCalledWith(
        pending.publicId,
        'VIDEO',
      );
    });

    it('é idempotente para um upload já confirmado', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        ...pending,
        status: StorageAssetStatus.ACTIVE,
      });

      const asset = await service.confirmUpload('asset-1', 'user-1');

      expect(asset.status).toBe(StorageAssetStatus.ACTIVE);
      expect(cloudinary.getAsset).not.toHaveBeenCalled();
    });

    it('esconde o upload de outro usuário como não encontrado', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue(pending);

      await expect(service.confirmUpload('asset-1', 'outro')).rejects.toThrow(
        'Upload não encontrado',
      );
    });
  });

  describe('deleteAsset', () => {
    it('marca como removido depois de apagar no provedor', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        publicId: 'x',
        resourceType: 'IMAGE',
        status: StorageAssetStatus.ACTIVE,
      });

      await service.deleteAsset('asset-1');

      expect(prisma.storedAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: StorageAssetStatus.DELETED }),
        }),
      );
    });

    // Marcar como removido sem ter removido criaria um arquivo invisível e
    // eterno no provedor — exatamente o tipo de órfão que o registro evita.
    it('mantém o registro ativo quando o provedor falha, para nova tentativa', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        publicId: 'x',
        resourceType: 'IMAGE',
        status: StorageAssetStatus.ACTIVE,
      });
      cloudinary.deleteAsset.mockResolvedValue(false);

      await service.deleteAsset('asset-1');

      expect(prisma.storedAsset.update).not.toHaveBeenCalled();
    });

    it('não faz nada com arquivo já removido', async () => {
      prisma.storedAsset.findUnique.mockResolvedValue({
        id: 'asset-1',
        status: StorageAssetStatus.DELETED,
      });

      await service.deleteAsset('asset-1');

      expect(cloudinary.deleteAsset).not.toHaveBeenCalled();
    });
  });
});
