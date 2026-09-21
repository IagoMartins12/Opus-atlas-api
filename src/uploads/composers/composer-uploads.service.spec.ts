import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { StorageService } from '../../common/storage/storage.service';
import { UploadHistoryService } from '../shared/upload-history.service';
import { ComposerUploadsService } from './composer-uploads.service';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

describe('ComposerUploadsService', () => {
  let service: ComposerUploadsService;
  let prisma: {
    composer: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    epoch: { findUnique: jest.Mock };
    role: { findUnique: jest.Mock };
    work: { findMany: jest.Mock };
    workScore: { count: jest.Mock; groupBy: jest.Mock };
    workAnnotation: { count: jest.Mock };
    favoriteComposer: { count: jest.Mock };
  };
  let history: { record: jest.Mock };
  let storage: { deleteByEntity: jest.Mock; findActiveByEntity: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

  const validDto = {
    name: 'Mozart',
    fullName: 'Wolfgang Amadeus Mozart',
    epochId: 'epoch-1',
    primaryRoleId: 'role-1',
  };

  beforeEach(async () => {
    prisma = {
      composer: {
        create: jest.fn().mockResolvedValue({
          id: 'composer-1',
          ...validDto,
          nationality: null,
          birthDate: null,
          deathDate: null,
          videoUrl: null,
          permLinkImslp: null,
          epoch: { name: 'Clássico' },
          primaryRole: { name: 'Compositor' },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'composer-1',
          epoch: { name: 'Clássico' },
          primaryRole: { name: 'Compositor' },
        }),
        delete: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      epoch: { findUnique: jest.fn().mockResolvedValue({ id: 'epoch-1' }) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-1' }) },
      work: { findMany: jest.fn().mockResolvedValue([]) },
      workScore: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      workAnnotation: { count: jest.fn().mockResolvedValue(0) },
      favoriteComposer: { count: jest.fn().mockResolvedValue(0) },
    };

    history = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      deleteByEntity: jest.fn().mockResolvedValue(0),
      findActiveByEntity: jest.fn().mockResolvedValue([]),
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComposerUploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityTracker, useValue: { track: jest.fn() } },
        { provide: UploadHistoryService, useValue: history },
        { provide: StorageService, useValue: storage },
        { provide: AppCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(ComposerUploadsService);
  });

  describe('create', () => {
    it('cadastra o compositor e registra no histórico', async () => {
      await service.create('user-1', validDto, context);

      expect(prisma.composer.create).toHaveBeenCalled();
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', entityType: 'composer' }),
      );
    });

    // Impede o mass assignment que o legado permitia com `data: { ...body }`.
    it('define os campos de curadoria no servidor, não pelo cliente', async () => {
      await service.create('user-1', validDto, context);

      const data = prisma.composer.create.mock.calls[0][0].data;

      expect(data.createdBy).toBe('user-1');
      expect(data.isCustom).toBe(true);
      expect(data).not.toHaveProperty('isVerified');
      expect(data).not.toHaveProperty('verifiedBy');
      expect(data).not.toHaveProperty('verificationStatus');
    });

    it('recusa época inexistente', async () => {
      prisma.epoch.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', validDto, context)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa papel inexistente', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', validDto, context)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calcula a completude a partir dos campos preenchidos', async () => {
      await service.create(
        'user-1',
        { ...validDto, bio: 'Compositor austríaco', nationality: 'Austríaco' },
        context,
      );

      // 4 de 10 campos preenchidos.
      expect(
        prisma.composer.create.mock.calls[0][0].data.dataCompleteness,
      ).toBe(40);
    });

    // O usuário precisa ver o próprio envio na hora, senão cadastra de novo.
    it('invalida o cache do catálogo', async () => {
      await service.create('user-1', validDto, context);

      expect(cache.invalidateMany).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.composer.findUnique.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Wolfgang Amadeus Mozart',
        createdBy: 'user-1',
      });
    });

    it('permite ao autor editar a própria contribuição', async () => {
      await expect(
        service.update(
          'user-1',
          false,
          'composer-1',
          { name: 'W. A. Mozart' },
          context,
        ),
      ).resolves.toBeDefined();
    });

    // Sem esta checagem, qualquer autenticado editaria os 19 mil compositores
    // importados do IMSLP.
    it('bloqueia edição de contribuição alheia', async () => {
      await expect(
        service.update('outro', false, 'composer-1', { name: 'X' }, context),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deixa o moderador editar qualquer contribuição', async () => {
      await expect(
        service.update('moderador', true, 'composer-1', { name: 'X' }, context),
      ).resolves.toBeDefined();
    });

    // Enviar `undefined` ao Prisma preserva; enviar `null` apagaria o dado.
    it('não toca em campos que não foram enviados', async () => {
      await service.update(
        'user-1',
        false,
        'composer-1',
        { name: 'Novo' },
        context,
      );

      const data = prisma.composer.update.mock.calls[0][0].data;

      expect(data.name).toBe('Novo');
      expect(data).not.toHaveProperty('bio');
      expect(data).not.toHaveProperty('nationality');
    });

    it('responde 404 para compositor inexistente', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(
        service.update('user-1', false, 'sumiu', {}, context),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.composer.findUnique.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Wolfgang Amadeus Mozart',
        createdBy: 'user-1',
      });
    });

    // Se o registro saísse primeiro e a remoção falhasse no meio, o retrato
    // ficaria no armazenamento sem nada apontando para ele.
    it('remove os arquivos antes do registro', async () => {
      await service.remove('user-1', false, 'composer-1', context);

      const storageOrder = storage.deleteByEntity.mock.invocationCallOrder[0];
      const deleteOrder = prisma.composer.delete.mock.invocationCallOrder[0];

      expect(storageOrder).toBeLessThan(deleteOrder);
    });

    it('bloqueia exclusão de contribuição alheia', async () => {
      await expect(
        service.remove('outro', false, 'composer-1', context),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('checkDuplicate', () => {
    it('encontra pelo link do IMSLP', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Wolfgang Amadeus Mozart',
        alternativeNames: null,
        imslpId: 'https://imslp.org/wiki/Category:Mozart',
        permLinkImslp: null,
        wikipediaLink: null,
        portraitUrl: null,
        nationality: null,
        birthDate: null,
        deathDate: null,
        epochName: null,
      });

      const result = await service.checkDuplicate({
        url: 'https://imslp.org/wiki/Category:Mozart',
        source: 'imslp',
      });

      expect(result.found).toBe(true);
      expect(result.reason).toBe('link do IMSLP');
    });

    it('encontra por grafia alternativa do nome', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Mozart, Wolfgang Amadeus',
        alternativeNames: null,
        imslpId: null,
        permLinkImslp: null,
        wikipediaLink: null,
        portraitUrl: null,
        nationality: null,
        birthDate: null,
        deathDate: null,
        epochName: null,
      });

      const result = await service.checkDuplicate({
        url: 'https://exemplo.com/mozart',
        source: 'wikipedia',
        fullName: 'Wolfgang Amadeus Mozart',
      });

      expect(result.found).toBe(true);
      expect(result.reason).toBe('nome');
    });

    it('devolve não encontrado quando não há equivalente', async () => {
      const result = await service.checkDuplicate({
        url: 'https://imslp.org/wiki/Category:Novo',
        source: 'imslp',
      });

      expect(result).toEqual({ found: false, composer: null });
    });

    // Sem exclusão, editar um compositor acusaria ele mesmo como duplicata.
    it('exclui da busca o compositor que está sendo editado', async () => {
      await service.checkDuplicate({
        url: 'https://imslp.org/wiki/Category:Mozart',
        source: 'imslp',
        excludeId: 'composer-1',
      });

      expect(prisma.composer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ id: { not: 'composer-1' } }]),
          }),
        }),
      );
    });

    it('não devolve os nomes alternativos internos na resposta', async () => {
      prisma.composer.findFirst.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Wolfgang Amadeus Mozart',
        alternativeNames: 'uso interno',
        imslpId: null,
        permLinkImslp: null,
        wikipediaLink: null,
        portraitUrl: null,
        nationality: null,
        birthDate: null,
        deathDate: null,
        epochName: null,
      });

      const result = await service.checkDuplicate({
        url: 'https://exemplo.com/x',
        source: 'wikipedia',
      });

      expect(result.composer).not.toHaveProperty('alternativeNames');
    });
  });

  describe('cascadeInfo', () => {
    it('conta o que será removido junto', async () => {
      prisma.composer.findUnique.mockResolvedValue({
        id: 'composer-1',
        name: 'Mozart',
        fullName: 'Wolfgang Amadeus Mozart',
        createdBy: 'user-1',
      });
      prisma.work.findMany.mockResolvedValue([
        { id: 'w1', title: 'Réquiem' },
        { id: 'w2', title: 'A Flauta Mágica' },
      ]);
      prisma.workScore.groupBy.mockResolvedValue([
        { workId: 'w1', _count: { _all: 3 } },
        { workId: 'w2', _count: { _all: 2 } },
      ]);
      prisma.favoriteComposer.count.mockResolvedValue(3);

      const info = await service.cascadeInfo('composer-1');

      expect(info.willDelete.works).toBe(2);
      expect(info.willDelete.scores).toBe(5);
      expect(info.willDelete.favorites).toBe(3);
      expect(info.works).toEqual([
        { id: 'w1', title: 'Réquiem', scoresCount: 3 },
        { id: 'w2', title: 'A Flauta Mágica', scoresCount: 2 },
      ]);
    });

    it('responde 404 para compositor inexistente', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(service.cascadeInfo('sumiu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
