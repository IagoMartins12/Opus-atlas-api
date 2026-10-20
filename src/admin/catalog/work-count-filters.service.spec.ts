import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkCountFiltersService } from './work-count-filters.service';

describe('WorkCountFiltersService', () => {
  let service: WorkCountFiltersService;
  // Por coleção: o que a agregação devolve (ids de obra).
  let porColecao: Record<string, string[]>;
  let prisma: {
    $runCommandRaw: jest.Mock;
    favoriteWork: { groupBy: jest.Mock };
    wantToLearn: { groupBy: jest.Mock };
    learned: { groupBy: jest.Mock };
  };

  const colecoesConsultadas = () =>
    prisma.$runCommandRaw.mock.calls.map(
      ([cmd]: [{ aggregate: string }]) => cmd.aggregate,
    );

  beforeEach(async () => {
    porColecao = {};
    prisma = {
      $runCommandRaw: jest.fn((cmd: { aggregate: string }) =>
        Promise.resolve({
          cursor: {
            firstBatch: (porColecao[cmd.aggregate] ?? []).map((id, i) => ({
              _id: { $oid: id },
              n: 100 - i,
            })),
          },
        }),
      ),
      favoriteWork: { groupBy: jest.fn().mockResolvedValue([]) },
      wantToLearn: { groupBy: jest.fn().mockResolvedValue([]) },
      learned: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkCountFiltersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkCountFiltersService);
  });

  it('sem filtro de contagem, não consulta nada', async () => {
    const result = await service.resolve({});

    expect(result.workIds).toBeNull();
    expect(prisma.$runCommandRaw).not.toHaveBeenCalled();
  });

  // O `groupBy` do Prisma com `orderBy` por contagem e `take` devolve grupos
  // quaisquer no MongoDB: o corte, a ordem e o teto vão na agregação.
  it('mínimo, ordem e teto vão na agregação, dentro do banco', async () => {
    await service.resolve({ minFavorites: 5 });

    const [cmd] = prisma.$runCommandRaw.mock.calls[0];
    expect(cmd.aggregate).toBe('FavoriteWork');
    expect(cmd.pipeline).toEqual([
      { $group: { _id: '$workId', n: { $sum: 1 } } },
      { $match: { n: { $gte: 5 } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: 1000 },
    ]);
  });

  it('cruza os critérios pedidos', async () => {
    porColecao.FavoriteWork = ['a', 'b', 'c'];
    porColecao.work_scores = ['b', 'c', 'd'];

    const result = await service.resolve({ minFavorites: 1, minScores: 1 });

    expect(result.workIds).toEqual(['b', 'c']);
  });

  it('interseção vazia devolve lista vazia, não nula', async () => {
    porColecao.FavoriteWork = ['a'];
    porColecao.work_scores = ['z'];

    const result = await service.resolve({ minFavorites: 1, minScores: 1 });

    expect(result.workIds).toEqual([]);
  });

  // O resultado vira um `IN` na consulta seguinte; um `IN` com dezenas de
  // milhares de ids é patológico no Mongo.
  it('avisa quando o critério bate no teto de candidatos', async () => {
    porColecao.FavoriteWork = Array.from({ length: 1000 }, (_, i) => `w${i}`);

    const result = await service.resolve({ minFavorites: 1 });

    expect(result.capped).toBe(true);
  });

  it('abaixo do teto, não avisa', async () => {
    porColecao.FavoriteWork = ['a', 'b'];

    const result = await service.resolve({ minFavorites: 1 });

    expect(result.capped).toBe(false);
  });

  it('consulta só os critérios pedidos', async () => {
    await service.resolve({ minLearned: 2 });

    expect(colecoesConsultadas()).toEqual(['Learned']);
  });

  it('máximo vira exclusão: as obras que passam dele', async () => {
    prisma.favoriteWork.groupBy.mockResolvedValue([{ workId: 'popular' }]);

    const result = await service.resolve({ maxFavorites: 3 });

    expect(prisma.favoriteWork.groupBy.mock.calls[0][0].having).toEqual({
      workId: { _count: { gt: 3 } },
    });
    expect(result.excludeIds).toEqual(['popular']);
    expect(result.workIds).toBeNull();
  });
});
