import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';
import { WorkCountFiltersService } from './work-count-filters.service';
import { AppCacheService } from '../../common/cache/cache.service';

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  let prisma: {
    composer: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    work: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    workScore: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    work: { count: jest.Mock; delete: jest.Mock };
    composer: { delete: jest.Mock };
    favoriteWork: { count: jest.Mock };
    wantToLearn: { count: jest.Mock };
    learned: { count: jest.Mock };
    workAnnotation: { count: jest.Mock };
    workScore: { count: jest.Mock };
  };
  let cache: { invalidateMany: jest.Mock };
  let countFilters: { resolve: jest.Mock };

  beforeEach(async () => {
    tx = {
      work: { count: jest.fn().mockResolvedValue(0), delete: jest.fn() },
      composer: { delete: jest.fn() },
      favoriteWork: { count: jest.fn().mockResolvedValue(0) },
      wantToLearn: { count: jest.fn().mockResolvedValue(0) },
      learned: { count: jest.fn().mockResolvedValue(0) },
      workAnnotation: { count: jest.fn().mockResolvedValue(0) },
      workScore: { count: jest.fn().mockResolvedValue(0) },
    };

    prisma = {
      composer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'composer-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'composer-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      work: {
        findUnique: jest.fn().mockResolvedValue({ id: 'work-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'work-1' }),
      },
      workScore: {
        findUnique: jest.fn().mockResolvedValue({ id: 'score-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'score-1' }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    countFilters = {
      resolve: jest.fn().mockResolvedValue({ workIds: null, capped: false }),
    };

    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkCountFiltersService, useValue: countFilters },
        { provide: AppCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(AdminCatalogService);
  });

  // -----------------------------------------------------------------
  describe('compositor', () => {
    it('recusa corpo vazio', async () => {
      await expect(
        service.updateComposer('admin-1', 'composer-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('compositor inexistente responde 404', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(
        service.updateComposer('admin-1', 'composer-1', { isVerified: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('verificar registra quem e quando', async () => {
      await service.updateComposer('admin-1', 'composer-1', {
        isVerified: true,
      });

      const { data } = prisma.composer.update.mock.calls[0][0];

      expect(data.verifiedBy).toBe('admin-1');
      expect(data.verifiedAt).toBeInstanceOf(Date);
    });

    it('desverificar limpa a atribuição', async () => {
      await service.updateComposer('admin-1', 'composer-1', {
        isVerified: false,
      });

      const { data } = prisma.composer.update.mock.calls[0][0];

      expect(data.verifiedBy).toBeNull();
      expect(data.verifiedAt).toBeNull();
    });

    // Entre contar e apagar, uma importação podia inserir obras que o cascade
    // levaria junto.
    it('a contagem de obras e a remoção vão na mesma transação', async () => {
      await service.deleteComposer('composer-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.work.count).toHaveBeenCalled();
      expect(tx.composer.delete).toHaveBeenCalled();
    });

    it('recusa remover compositor com obras', async () => {
      tx.work.count.mockResolvedValue(12);

      await expect(service.deleteComposer('composer-1')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.composer.delete).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('obra', () => {
    // `Work` não tem `dataQuality` nem `verificationNotes`; o legado os gravava
    // e o Prisma recusava a escrita inteira.
    it('a verificação grava só os campos que existem em `Work`', async () => {
      await service.updateWork('admin-1', 'work-1', { isVerified: true });

      const { data } = prisma.work.update.mock.calls[0][0];

      expect(data.isVerified).toBe(true);
      expect(data.verifiedBy).toBe('admin-1');
      expect(data).not.toHaveProperty('verificationNotes');
      expect(data).not.toHaveProperty('dataQuality');
    });

    it('registra quem editou por último', async () => {
      await service.updateWork('admin-1', 'work-1', { title: 'Novo título' });

      const { data } = prisma.work.update.mock.calls[0][0];

      expect(data.lastEditedBy).toBe('admin-1');
      expect(data.lastEditedAt).toBeInstanceOf(Date);
    });

    // O legado só contava anotação pública, mas o cascade apaga todas.
    it('anotação privada impede a remoção', async () => {
      tx.workAnnotation.count.mockResolvedValue(50);

      await expect(service.deleteWork('work-1')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.work.delete).not.toHaveBeenCalled();
    });

    it('a contagem de anotações não filtra por visibilidade', async () => {
      tx.workAnnotation.count.mockResolvedValue(0);

      await service.deleteWork('work-1');

      expect(tx.workAnnotation.count.mock.calls[0][0].where).toEqual({
        workId: 'work-1',
      });
    });

    it('partitura associada impede a remoção', async () => {
      tx.workScore.count.mockResolvedValue(3);

      await expect(service.deleteWork('work-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('sem dependência, remove', async () => {
      await expect(service.deleteWork('work-1')).resolves.toBeUndefined();
      expect(tx.work.delete).toHaveBeenCalled();
    });

    it('a mensagem lista o que está bloqueando', async () => {
      tx.favoriteWork.count.mockResolvedValue(2);
      tx.learned.count.mockResolvedValue(1);

      await expect(service.deleteWork('work-1')).rejects.toThrow(
        /2 favorito\(s\).*1 em "já aprendi"/,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('listagem de obras', () => {
    it('sem filtro de contagem, não restringe por id', async () => {
      await service.listWorks({});

      expect(prisma.work.findMany.mock.calls[0][0].where.id).toBeUndefined();
    });

    it('com filtro de contagem, restringe pelos candidatos', async () => {
      countFilters.resolve.mockResolvedValue({
        workIds: ['a', 'b'],
        capped: false,
      });

      await service.listWorks({ minFavorites: 5 });

      expect(prisma.work.findMany.mock.calls[0][0].where.id).toEqual({
        in: ['a', 'b'],
      });
    });

    // Montar um `IN` vazio e consultar seria trabalho jogado fora.
    it('interseção vazia responde sem consultar obras', async () => {
      countFilters.resolve.mockResolvedValue({ workIds: [], capped: false });

      const result = await service.listWorks({ minFavorites: 999 });

      expect(result.works).toEqual([]);
      expect(prisma.work.findMany).not.toHaveBeenCalled();
    });

    it('propaga o aviso de cobertura', async () => {
      countFilters.resolve.mockResolvedValue({
        workIds: ['a'],
        capped: true,
      });

      const result = await service.listWorks({ minScores: 1 });

      expect(result.coverage.countFilterCapped).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  describe('partitura', () => {
    it('desativar não apaga', async () => {
      await service.updateScore('score-1', { isActive: false });

      const { data } = prisma.workScore.update.mock.calls[0][0];

      expect(data.isActive).toBe(false);
    });

    it('partitura inexistente responde 404', async () => {
      prisma.workScore.findUnique.mockResolvedValue(null);

      await expect(
        service.updateScore('score-1', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('verificação em lote', () => {
    beforeEach(() => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'c1', name: 'Bach', fullName: 'Johann Sebastian Bach' },
      ]);
      prisma.composer.updateMany.mockResolvedValue({ count: 1 });
    });

    it('aplica a mesma transição da verificação singular', async () => {
      await service.verifyComposersInBulk('admin-1', ['c1'], true, 'Conferido');

      const data = prisma.composer.updateMany.mock.calls[0][0].data;

      expect(data.isVerified).toBe(true);
      expect(data.verificationStatus).toBe('verified');
      expect(data.verifiedBy).toBe('admin-1');
      expect(data.verificationNotes).toBe('Conferido');
    });

    it('desverificar em lote também limpa a atribuição', async () => {
      await service.verifyComposersInBulk('admin-1', ['c1'], false);

      const data = prisma.composer.updateMany.mock.calls[0][0].data;

      expect(data.verifiedBy).toBeNull();
      expect(data.verifiedAt).toBeNull();
      expect(data.verificationStatus).toBe('pending');
    });

    // O legado devolvia só a contagem: pedir 50 e receber "40 atualizados" sem
    // saber quais dez não existiam é um relatório inútil.
    it('devolve quais foram tocados e quais ids não existiam', async () => {
      const result = await service.verifyComposersInBulk(
        'admin-1',
        ['c1', 'c2'],
        true,
      );

      expect(result.updated).toBe(1);
      expect(result.composers).toEqual([
        { id: 'c1', name: 'Johann Sebastian Bach' },
      ]);
      expect(result.notFound).toEqual(['c2']);
    });

    it('só escreve nos ids que existem', async () => {
      await service.verifyComposersInBulk('admin-1', ['c1', 'c2'], true);

      expect(prisma.composer.updateMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c1'] },
      });
    });

    it('recusa quando nenhum id existe', async () => {
      prisma.composer.findMany.mockResolvedValue([]);

      await expect(
        service.verifyComposersInBulk('admin-1', ['x'], true),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.composer.updateMany).not.toHaveBeenCalled();
    });

    // Sem isto, o compositor recém-verificado seguiria sem selo na rota
    // pública até o TTL expirar.
    it('derruba o cache do catálogo público', async () => {
      await service.verifyComposersInBulk('admin-1', ['c1'], true);

      expect(cache.invalidateMany).toHaveBeenCalledWith([
        'works',
        'composers',
        'discovery',
        'epochs',
      ]);
    });
  });
});
