import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkCountFiltersService } from './work-count-filters.service';

describe('WorkCountFiltersService', () => {
  let service: WorkCountFiltersService;
  let prisma: {
    favoriteWork: { groupBy: jest.Mock };
    wantToLearn: { groupBy: jest.Mock };
    learned: { groupBy: jest.Mock };
    workScore: { groupBy: jest.Mock };
  };

  const ids = (...values: string[]) => values.map((workId) => ({ workId }));

  beforeEach(async () => {
    prisma = {
      favoriteWork: { groupBy: jest.fn().mockResolvedValue([]) },
      wantToLearn: { groupBy: jest.fn().mockResolvedValue([]) },
      learned: { groupBy: jest.fn().mockResolvedValue([]) },
      workScore: { groupBy: jest.fn().mockResolvedValue([]) },
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
    expect(prisma.favoriteWork.groupBy).not.toHaveBeenCalled();
  });

  // O legado fazia `groupBy` sem `where` sobre a coleção inteira — 92 mil
  // partituras em até 207 mil grupos — e aplicava o `>= N` com `.filter()` no
  // Node.
  it('o corte por contagem vai no `having`, não em memória', async () => {
    await service.resolve({ minFavorites: 5 });

    const args = prisma.favoriteWork.groupBy.mock.calls[0][0];

    expect(args.having).toEqual({ workId: { _count: { gte: 5 } } });
    expect(args.take).toBe(1000);
    expect(args.orderBy).toEqual({ _count: { workId: 'desc' } });
  });

  it('cruza os critérios pedidos', async () => {
    prisma.favoriteWork.groupBy.mockResolvedValue(ids('a', 'b', 'c'));
    prisma.workScore.groupBy.mockResolvedValue(ids('b', 'c', 'd'));

    const result = await service.resolve({ minFavorites: 1, minScores: 1 });

    expect(result.workIds).toEqual(['b', 'c']);
  });

  it('interseção vazia devolve lista vazia, não nula', async () => {
    prisma.favoriteWork.groupBy.mockResolvedValue(ids('a'));
    prisma.workScore.groupBy.mockResolvedValue(ids('z'));

    const result = await service.resolve({ minFavorites: 1, minScores: 1 });

    expect(result.workIds).toEqual([]);
  });

  // O resultado vira um `IN` na consulta seguinte; um `IN` com dezenas de
  // milhares de ids é patológico no Mongo.
  it('avisa quando o critério bate no teto de candidatos', async () => {
    prisma.favoriteWork.groupBy.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({ workId: `w${index}` })),
    );

    const result = await service.resolve({ minFavorites: 1 });

    expect(result.capped).toBe(true);
  });

  it('abaixo do teto, não avisa', async () => {
    prisma.favoriteWork.groupBy.mockResolvedValue(ids('a', 'b'));

    const result = await service.resolve({ minFavorites: 1 });

    expect(result.capped).toBe(false);
  });

  it('consulta só os critérios pedidos', async () => {
    await service.resolve({ minLearned: 2 });

    expect(prisma.learned.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.favoriteWork.groupBy).not.toHaveBeenCalled();
    expect(prisma.workScore.groupBy).not.toHaveBeenCalled();
  });
});
