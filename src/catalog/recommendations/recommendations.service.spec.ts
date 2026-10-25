import { RecommendationsService } from './recommendations.service';

/**
 * At least four recommendations, on the work page and in "Recomendadas para
 * você" (owner's call, 25/10/2026): what the ranking does not find comes from
 * the most studied works, never from the person's own lists.
 */
describe('RecommendationsService — mínimo de quatro', () => {
  const work = (id: string) => ({
    id,
    title: `Obra ${id}`,
    opOrCatalog: null,
    difficultyLevel: null,
    composer: { id: 'c1', name: 'Chopin', portraitUrl: null },
    epoch: null,
    instrument: null,
  });

  function setup(plan: 'FREE' | 'PLUS') {
    const popularIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const prisma = {
      learned: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      wantToLearn: {
        // p1 is on the person's list (`listedBy`), but gives the ranking
        // nothing to start from (`seedsOf` asks with `take`).
        findMany: jest.fn(({ take }: { take?: number }) =>
          Promise.resolve(take ? [] : [{ workId: 'p1' }]),
        ),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      favoriteWork: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue(
          popularIds.map((workId, i) => ({
            workId,
            _count: { _all: 10 - i },
          })),
        ),
      },
      work: {
        // The popular list, then the hydrate: both look works up by id.
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve((where?.id?.in ?? popularIds).map(work)),
        ),
      },
    };
    const subscriptions = {
      effectivePlan: jest.fn().mockResolvedValue({ plan }),
    };
    const cache = {
      remember: jest.fn((_k: string, _o: unknown, fn: () => unknown) => fn()),
    };
    const service = new RecommendationsService(
      prisma as never,
      subscriptions as never,
      cache as never,
    );
    return { service, prisma };
  }

  it('quem ainda não tem nada nas listas recebe quatro das mais estudadas', async () => {
    const { service, prisma } = setup('PLUS');
    prisma.wantToLearn.findMany.mockImplementation(() => Promise.resolve([]));

    const result = await service.forUser('u1');

    expect(result.items).toHaveLength(4);
    expect(result.items.every((w) => w.reasons.includes('popular'))).toBe(true);
  });

  it('não recomenda o que já está nas listas da pessoa', async () => {
    const { service } = setup('PLUS');

    const result = await service.forUser('u1');

    expect(result.items.map((w) => w.id)).not.toContain('p1');
    expect(result.items).toHaveLength(4);
  });

  it('sem o Plus, o convite mostra quatro, desfocadas', async () => {
    const { service } = setup('FREE');

    const result = await service.forUser('u1');

    expect(result.locked).toBe(true);
    expect(result.items).toHaveLength(4);
  });
});
