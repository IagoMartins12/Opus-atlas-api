import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ComposerOnThisDayService } from './composer-on-this-day.service';

describe('ComposerOnThisDayService', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'Chopin',
    fullName: 'Frédéric Chopin',
    portraitUrl: 'https://imslp.org/chopin.jpg',
    hasValidImage: true,
    birthYear: 1810,
    deathYear: 1849,
    nationality: 'Polish',
    epochName: 'Romântico',
    isVerified: true,
    ...over,
  });
  let findMany: jest.Mock;
  let service: ComposerOnThisDayService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    service = new ComposerOnThisDayService(
      { composer: { findMany } } as unknown as PrismaService,
      {
        remember: jest.fn((_k: string, _o: unknown, load: () => unknown) =>
          load(),
        ),
      } as unknown as AppCacheService,
    );
  });

  it('busca nascidos e mortos pelo mês e dia', async () => {
    findMany.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);

    const result = await service.get(3, 1);

    expect(findMany.mock.calls[0][0].where.AND[1]).toEqual({
      birthMonth: 3,
      birthDay: 1,
    });
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({
      deathMonth: 3,
      deathDay: 1,
    });
    expect(result.born[0]).toMatchObject({ name: 'Chopin', birthYear: 1810 });
    expect(result.born[0]).not.toHaveProperty('hasValidImage');
  });

  it('retrato inválido (o "no photo" do IMSLP) vira null', async () => {
    findMany.mockResolvedValueOnce([row({ hasValidImage: false })]);

    const { born } = await service.get(10, 17);

    expect(born[0].portraitUrl).toBeNull();
  });

  it('o mesmo compositor gravado duas vezes aparece uma vez', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(), row({ id: 'c2', hasValidImage: false })]);

    const { died } = await service.get(10, 17);

    expect(died.map((c) => c.id)).toEqual(['c1']);
  });
});
