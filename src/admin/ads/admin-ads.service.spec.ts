import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdPlacement,
  AdStatus,
  AdTargetType,
  AdType,
  Prisma,
} from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAdsService } from './admin-ads.service';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '6.19.0',
  });

describe('AdminAdsService', () => {
  let service: AdminAdsService;
  let prisma: {
    advertisement: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    adStats: { groupBy: jest.Mock; aggregate: jest.Mock };
    storedAsset: { update: jest.Mock };
  };
  let storage: {
    deleteByEntity: jest.Mock;
    confirmUpload: jest.Mock;
  };

  const ad = (over: Record<string, unknown> = {}) => ({
    id: 'ad-1',
    title: 'Curso de piano',
    type: AdType.BANNER,
    placement: AdPlacement.SIDEBAR_RIGHT,
    targetType: AdTargetType.GENERAL,
    instrumentId: null,
    startDate: null,
    endDate: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      advertisement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(ad()),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(ad()),
        update: jest.fn().mockResolvedValue(ad()),
        delete: jest.fn().mockResolvedValue({}),
      },
      adStats: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { impressions: null, clicks: null } }),
      },
      storedAsset: { update: jest.fn().mockResolvedValue({}) },
    };

    storage = {
      deleteByEntity: jest.fn().mockResolvedValue(1),
      confirmUpload: jest.fn().mockResolvedValue({
        id: 'asset-1',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAdsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(AdminAdsService);
  });

  const createDto = { title: 'Curso de piano', advertiserName: 'Harmonia' };

  // -----------------------------------------------------------------
  describe('desempenho', () => {
    // O legado carregava a relação `stats` inteira: uma linha por dia e
    // dispositivo, somadas em JavaScript.
    it('impressões e cliques saem de uma agregação', async () => {
      prisma.advertisement.findMany.mockResolvedValue([
        ad(),
        ad({ id: 'ad-2' }),
      ]);
      prisma.adStats.groupBy.mockResolvedValue([
        { advertisementId: 'ad-1', _sum: { impressions: 1000, clicks: 25 } },
      ]);

      const result = await service.list({});

      expect(prisma.adStats.groupBy).toHaveBeenCalledTimes(1);
      expect(result.ads[0].performance).toEqual({
        impressions: 1000,
        clicks: 25,
        ctr: 2.5,
      });
    });

    // Taxa de clique sem impressão não é zero, é ausência de medida.
    it('CTR é nulo quando não houve impressão', async () => {
      prisma.advertisement.findMany.mockResolvedValue([ad()]);

      const result = await service.list({});

      expect(result.ads[0].performance.ctr).toBeNull();
    });

    it('sem anúncios, não agrega', async () => {
      await service.list({});

      expect(prisma.adStats.groupBy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('conflito de combinação', () => {
    // Com `placement` ausente, o Prisma descartava o campo e a busca casava
    // com um anúncio de outro posicionamento.
    it('aplica os defaults do schema antes de consultar', async () => {
      await service.create('admin-1', createDto);

      const { data } = prisma.advertisement.create.mock.calls[0][0];

      expect(data.type).toBe(AdType.BANNER);
      expect(data.placement).toBe(AdPlacement.SIDEBAR_RIGHT);
      expect(data.targetType).toBe(AdTargetType.GENERAL);
      expect(data.instrumentId).toBeNull();
    });

    // O legado comparava `error.message.includes('unique constraint')`.
    it('a violação da restrição vira 409, reconhecida pelo código', async () => {
      prisma.advertisement.create.mockRejectedValue(p2002());
      prisma.advertisement.findFirst.mockResolvedValue({
        id: 'ad-9',
        title: 'Outro',
        status: AdStatus.ACTIVE,
      });

      await expect(service.create('admin-1', createDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('erro que não é de unicidade sobe como está', async () => {
      prisma.advertisement.create.mockRejectedValue(new Error('banco fora'));

      await expect(service.create('admin-1', createDto)).rejects.toThrow(
        'banco fora',
      );
    });

    it('a checagem isolada informa qual anúncio ocupa a combinação', async () => {
      prisma.advertisement.findFirst.mockResolvedValue({
        id: 'ad-9',
        title: 'Outro',
        status: AdStatus.ACTIVE,
      });

      const result = await service.checkConflict({
        type: AdType.BANNER,
        placement: AdPlacement.SIDEBAR_RIGHT,
        targetType: AdTargetType.GENERAL,
      });

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingAd?.id).toBe('ad-9');
    });

    it('a checagem ignora o próprio anúncio quando pedido', async () => {
      await service.checkConflict({
        type: AdType.BANNER,
        placement: AdPlacement.SIDEBAR_RIGHT,
        targetType: AdTargetType.GENERAL,
        excludeAdId: 'ad-1',
      });

      expect(prisma.advertisement.findFirst.mock.calls[0][0].where.id).toEqual({
        not: 'ad-1',
      });
    });
  });

  // -----------------------------------------------------------------
  describe('período de veiculação', () => {
    it('recusa fim anterior ao início', async () => {
      await expect(
        service.create('admin-1', {
          ...createDto,
          startDate: '2026-06-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita período coerente', async () => {
      await expect(
        service.create('admin-1', {
          ...createDto,
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-06-01T00:00:00.000Z',
        }),
      ).resolves.toBeDefined();
    });
  });

  // -----------------------------------------------------------------
  describe('clone', () => {
    // O legado fazia `fetch()` para a própria API, com endereço fixo de
    // desenvolvimento e o cookie do administrador.
    it('verifica o conflito em processo, sem autochamada HTTP', async () => {
      prisma.advertisement.create.mockRejectedValue(p2002());

      await expect(service.clone('admin-1', 'ad-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    // Dois anúncios apontando para o mesmo arquivo fariam a remoção de um
    // levar a imagem do outro.
    it('o clone nasce sem mídia', async () => {
      await service.clone('admin-1', 'ad-1', {});

      const { data } = prisma.advertisement.create.mock.calls[0][0];

      expect(data.imageUrl).toBeUndefined();
      expect(data.videoUrl).toBeUndefined();
    });

    it('o clone nasce como rascunho', async () => {
      await service.clone('admin-1', 'ad-1', {});

      expect(prisma.advertisement.create.mock.calls[0][0].data.status).toBe(
        AdStatus.DRAFT,
      );
    });

    it('as modificações pedidas prevalecem sobre o original', async () => {
      await service.clone('admin-1', 'ad-1', {
        placement: AdPlacement.HEADER,
        title: 'Nova campanha',
      });

      const { data } = prisma.advertisement.create.mock.calls[0][0];

      expect(data.placement).toBe(AdPlacement.HEADER);
      expect(data.title).toBe('Nova campanha');
    });

    it('sem título, deriva do original', async () => {
      await service.clone('admin-1', 'ad-1', {});

      expect(prisma.advertisement.create.mock.calls[0][0].data.title).toBe(
        'Curso de piano — Cópia',
      );
    });

    it('anúncio inexistente responde 404', async () => {
      prisma.advertisement.findUnique.mockResolvedValue(null);

      await expect(service.clone('admin-1', 'ad-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('remoção', () => {
    // O legado apagava um diretório derivado do título: renomear o anúncio
    // deixava o arquivo órfão.
    it('a mídia sai pelo registro de armazenamento', async () => {
      await service.remove('ad-1');

      expect(storage.deleteByEntity).toHaveBeenCalledWith(
        'advertisement',
        'ad-1',
      );
      expect(prisma.advertisement.delete).toHaveBeenCalled();
    });

    it('falha na limpeza não impede a remoção', async () => {
      storage.deleteByEntity.mockRejectedValue(new Error('cloudinary fora'));

      await expect(service.remove('ad-1')).resolves.toBeUndefined();
      expect(prisma.advertisement.delete).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('mídia', () => {
    it('confirma a posse antes de anexar', async () => {
      await service.attachMedia('admin-1', 'ad-1', { assetId: 'asset-1' });

      expect(storage.confirmUpload).toHaveBeenCalledWith('asset-1', 'admin-1');
      expect(prisma.advertisement.update.mock.calls[0][0].data.imageUrl).toBe(
        'https://res.cloudinary.com/demo/image/upload/v1/a.png',
      );
    });

    it('vídeo vai para o campo de vídeo', async () => {
      await service.attachMedia('admin-1', 'ad-1', {
        assetId: 'asset-1',
        kind: 'video',
      });

      const { data } = prisma.advertisement.update.mock.calls[0][0];

      expect(data.videoUrl).toBeDefined();
      expect(data.imageUrl).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  describe('edição', () => {
    it('recusa corpo vazio', async () => {
      await expect(service.update('admin-1', 'ad-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('registra quem editou', async () => {
      await service.update('admin-1', 'ad-1', { title: 'Novo' });

      const { data } = prisma.advertisement.update.mock.calls[0][0];

      expect(data.lastEditedBy).toBe('admin-1');
      expect(data.lastEditedAt).toBeInstanceOf(Date);
    });
  });
});
