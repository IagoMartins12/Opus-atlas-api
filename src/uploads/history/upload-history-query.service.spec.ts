import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadHistoryQueryService } from './upload-history-query.service';

describe('UploadHistoryQueryService', () => {
  let service: UploadHistoryQueryService;
  let prisma: {
    uploadHistory: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    composer: { count: jest.Mock };
    work: { count: jest.Mock };
    workScore: { count: jest.Mock };
    uploadModeration: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      uploadHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      composer: { count: jest.fn().mockResolvedValue(2) },
      work: { count: jest.fn().mockResolvedValue(5) },
      workScore: { count: jest.fn().mockResolvedValue(3) },
      uploadModeration: { count: jest.fn().mockResolvedValue(1) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadHistoryQueryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(UploadHistoryQueryService);
  });

  const whereOf = () => prisma.uploadHistory.findMany.mock.calls[0][0].where;

  describe('list', () => {
    it('restringe ao próprio usuário por padrão', async () => {
      await service.list('user-1', false, {});

      expect(whereOf().userId).toBe('user-1');
    });

    // No legado, `userId` era aceito de qualquer um: bastava passar o id alheio
    // para ler o histórico de contribuições de outra pessoa.
    it('bloqueia consulta ao histórico de outro usuário', async () => {
      await expect(
        service.list('user-1', false, { userId: 'outro' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deixa o moderador consultar o histórico de outro usuário', async () => {
      await service.list('moderador', true, { userId: 'outro' });

      expect(whereOf().userId).toBe('outro');
    });

    it('permite passar o próprio id explicitamente', async () => {
      await expect(
        service.list('user-1', false, { userId: 'user-1' }),
      ).resolves.toBeDefined();
    });

    it('ignora os filtros com valor "all"', async () => {
      await service.list('user-1', false, { type: 'all', action: 'all' });

      expect(whereOf()).not.toHaveProperty('entityType');
      expect(whereOf()).not.toHaveProperty('action');
    });

    it('aplica os filtros de tipo e ação', async () => {
      await service.list('user-1', false, { type: 'work', action: 'create' });

      expect(whereOf().entityType).toBe('work');
      expect(whereOf().action).toBe('create');
    });

    // Sem estender ao fim do dia, filtrar "até hoje" esconderia tudo o que foi
    // feito hoje depois da meia-noite.
    it('inclui o dia inteiro no fim do período', async () => {
      await service.list('user-1', false, { dateTo: '2026-09-07' });

      const end = whereOf().createdAt.lte as Date;

      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
    });
  });

  describe('contributionTotals', () => {
    it('soma o que o usuário tem publicado agora', async () => {
      const totals = await service.contributionTotals('user-1');

      expect(totals).toEqual({
        composers: 2,
        works: 5,
        scores: 3,
        total: 10,
        pendingReports: 1,
      });
    });
  });

  describe('recent', () => {
    it('limita o número de linhas devolvidas', async () => {
      await service.recent('user-1', 500);

      expect(prisma.uploadHistory.findMany.mock.calls[0][0].take).toBe(50);
    });
  });

  // "Meus envios" (`GET /uploads/mine`) — no legado, `getUserUploads` no front.
  describe('listMine', () => {
    const at = (day: string) => new Date(`2026-${day}T00:00:00Z`);
    const composerRow = {
      id: 'c1',
      name: 'Bach',
      fullName: 'J. S. Bach',
      portraitUrl: null,
      createdAt: at('01-01'),
      updatedAt: at('01-02'),
      imslpId: null,
      dataQuality: null,
      verificationStatus: 'pending',
      epoch: { name: 'Barroco' },
    };
    const workRow = {
      id: 'w1',
      title: 'Op. 1',
      createdAt: at('03-01'),
      updatedAt: at('03-02'),
      imslpId: null,
      imslpPermlink: 'p',
      composer: { id: 'c1', name: 'Bach', fullName: 'J. S. Bach' },
      epoch: { name: 'Barroco' },
      instrument: null,
      workGenresArr: [],
      categoryNames: [],
    };
    const scoreRow = {
      id: 's1',
      title: 'Partitura',
      source: 'UPLOAD',
      fileSize: null,
      pageCount: null,
      downloadUrl: null,
      dataQuality: null,
      verificationStatus: null,
      createdAt: at('02-01'),
      updatedAt: at('02-02'),
      work: {
        id: 'w1',
        title: 'Op. 1',
        composer: { id: 'c1', name: 'Bach', fullName: null },
      },
    };

    let findMany: Record<'composer' | 'work' | 'workScore', jest.Mock>;

    beforeEach(() => {
      // A mesma `findMany` serve para a listagem e para os ids da busca.
      findMany = {
        composer: jest.fn((args: { where: { id?: unknown } }) =>
          Promise.resolve(args.where.id ? [{ id: 'c1' }] : [composerRow]),
        ),
        work: jest.fn((args: { distinct?: unknown; select: object }) =>
          Promise.resolve(
            args.distinct
              ? [{ composerId: 'c1' }]
              : 'title' in args.select
                ? [workRow]
                : [{ id: 'w1' }],
          ),
        ),
        workScore: jest.fn((args: { distinct?: unknown }) =>
          Promise.resolve(args.distinct ? [{ workId: 'w1' }] : [scoreRow]),
        ),
      };
      for (const model of ['composer', 'work', 'workScore'] as const) {
        (prisma[model] as Record<string, jest.Mock>).findMany = findMany[model];
      }
    });

    it('só o que a pessoa criou, com a contagem de cada tipo, até 16 por tipo e do mais novo ao mais antigo', async () => {
      const result = await service.listMine('user-1', { limitPerType: true });

      expect(result.items.map((item) => item.id)).toEqual(['w1', 's1', 'c1']);
      expect(result).toMatchObject({
        composerCount: 2,
        workCount: 5,
        scoreCount: 3,
        totalCount: 10,
        hasMoreComposers: false,
      });
      expect(findMany.composer.mock.calls[0][0]).toMatchObject({
        where: { createdBy: 'user-1' },
        take: 16,
      });
      expect(result.items[1]).toMatchObject({
        type: 'score',
        isIMSLP: false,
        composerName: 'Bach',
        workTitle: 'Op. 1',
      });
    });

    it('a busca escapa o texto e acha a obra pelo compositor por id, sem filtro de relação', async () => {
      await service.listMine('user-1', { search: 'op.', type: 'work' });

      const where = prisma.work.count.mock.calls[0][0].where;
      const serialized = JSON.stringify(where);
      expect(serialized).toContain('"contains":"op\\\\."');
      expect(serialized).toContain('"composerId":{"in":["c1"]}');
      expect(serialized).not.toContain('"composer":');
    });
  });
});
