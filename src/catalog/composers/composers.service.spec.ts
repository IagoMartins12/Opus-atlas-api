import { NotFoundException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ComposersService } from './composers.service';

const ID = '685d7a5ba35690a68f9df8ed';

const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Chopin',
  fullName: 'Frédéric Chopin',
  birthDate: ' 1810 ',
  deathDate: '',
  portraitUrl: null,
  epochId: 'e1',
  bio: null,
  permLinkImslp: null,
  wikipediaLink: null,
  imslpId: null,
  isVerified: true,
  epoch: { name: 'Romântico' },
  ...overrides,
});

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  ...listRow(),
  alternativeNames: null,
  videoUrl: null,
  bioEn: 'English bio',
  bioGeneratedBy: 'anthropic/claude-opus-5',
  roles: 'r1, r2,',
  primaryRoleId: 'r1',
  createdAt: new Date('2026-01-01'),
  nationality: 'Polonês',
  instruments: null,
  imslpCategories: null,
  verificationStatus: null,
  verifiedBy: null,
  verifiedAt: null,
  verificationNotes: null,
  pageQuality: null,
  lastVerified: null,
  dataCompleteness: null,
  hasValidImage: false,
  primaryRole: { name: 'Compositor' },
  _count: { works: 42 },
  ...overrides,
});

describe('ComposersService', () => {
  let prisma: {
    composer: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
    work: { findMany: jest.Mock; count: jest.Mock; groupBy: jest.Mock };
    role: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: ComposersService;

  beforeEach(() => {
    prisma = {
      composer: {
        findMany: jest.fn().mockResolvedValue([listRow()]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: ID }),
        count: jest.fn().mockResolvedValue(19177),
      },
      work: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ name: 'Compositor' }, { name: 'Pianista' }]),
      },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new ComposersService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
    );
  });

  describe('lista e contagem', () => {
    it('normaliza a página e limpa texto vazio', async () => {
      const [item] = await service.findAll({ page: 0, limit: 500 });

      expect(prisma.composer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
      expect(item).toMatchObject({
        birthDate: '1810',
        deathDate: null,
        epochName: 'Romântico',
        epoch: { name: 'Romântico' },
      });
    });

    it('busca por palavras em nome ou nome completo, com época', async () => {
      await service.findAll({ search: 'fre chop', epochId: 'e1' });

      const [{ where }] = prisma.composer.findMany.mock.calls[0];
      expect(where.AND).toHaveLength(3);
      expect(where.AND[1].OR[0].AND).toEqual([
        { name: { contains: 'fre', mode: 'insensitive' } },
        { name: { contains: 'chop', mode: 'insensitive' } },
      ]);
      expect(where.AND[2]).toEqual({ epochId: 'e1' });
    });

    // Um "." era expressão regular e casava os 19 mil compositores.
    it('termo de busca é escapado', async () => {
      await service.count({ search: 'J.' });

      const [{ where }] = prisma.composer.count.mock.calls[0];
      expect(where.AND[1].OR[1].AND[0].fullName.contains).toBe('J\\.');
    });

    it('contagem e lista em cache não vão ao banco (inclusive contagem 0)', async () => {
      cache.get.mockResolvedValue(0);
      await expect(service.count({})).resolves.toBe(0);

      cache.get.mockResolvedValue([{ id: 'x' }]);
      await expect(service.findAll({})).resolves.toEqual([{ id: 'x' }]);
      expect(prisma.composer.count).not.toHaveBeenCalled();
    });

    it('sem filtro, só o papel de compositor', async () => {
      await service.count({});

      const [{ where }] = prisma.composer.count.mock.calls[0];
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('listas curadas', () => {
    it('famosos na ordem da curadoria, desconhecidos no fim', async () => {
      prisma.composer.findMany.mockResolvedValue([
        listRow({ id: 'x', fullName: 'Fora da lista' }),
        listRow({ id: 'chopin', fullName: 'Frédéric Chopin' }),
        listRow({ id: 'beethoven', fullName: 'Ludwig van Beethoven' }),
      ]);

      const famous = await service.findFamous();

      expect(famous.map((c) => c.id)).toEqual(['beethoven', 'chopin', 'x']);
    });

    it('recomendados usam a própria lista e o cache', async () => {
      await service.findRecommended();
      expect(cache.set).toHaveBeenCalledWith(
        'composers:recommended',
        expect.any(Array),
        expect.any(Number),
      );

      cache.get.mockResolvedValue([{ id: 'c' }]);
      await expect(service.findRecommended()).resolves.toEqual([{ id: 'c' }]);
    });
  });

  describe('compositor em destaque', () => {
    const featured = (fullName: string) => ({
      ...listRow({ fullName }),
      works: [{ id: 'w1', title: 'Noturno', imslpPermlink: null }],
      epoch: null,
    });

    it('escolhe um da rotação que exista no banco', async () => {
      prisma.composer.findMany.mockResolvedValue([featured('Frédéric Chopin')]);

      const result = await service.findFeatured();

      expect(result).toMatchObject({
        fullName: 'Frédéric Chopin',
        epochName: 'Clássico',
        works: [{ id: 'w1', title: 'Noturno', imslpPermlink: null }],
      });
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^composers:featured:\d{4}-\d+$/),
        result,
        25 * 60 * 60 * 1000,
      );
    });

    it('nenhum da rotação no banco: qualquer compositor', async () => {
      prisma.composer.findMany.mockResolvedValue([]);
      prisma.composer.findFirst.mockResolvedValue(featured('Alguém'));

      await expect(service.findFeatured()).resolves.toMatchObject({
        fullName: 'Alguém',
      });
    });

    it('banco sem compositor é 404; cache não vai ao banco', async () => {
      prisma.composer.findMany.mockResolvedValue([]);
      await expect(service.findFeatured()).rejects.toBeInstanceOf(
        NotFoundException,
      );

      cache.get.mockResolvedValue({ id: 'cache' });
      await expect(service.findFeatured()).resolves.toEqual({ id: 'cache' });
    });
  });

  describe('detalhe', () => {
    it('resolve os papéis, a biografia em inglês e o aviso de IA', async () => {
      prisma.composer.findUnique.mockResolvedValue(detailRow());

      const detail = await service.findOne(ID);

      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['r1', 'r2'] } },
        select: { name: true },
      });
      expect(detail).toMatchObject({
        roleNames: ['Compositor', 'Pianista'],
        bioEn: 'English bio',
        bioGeneratedByAi: true,
        worksCount: 42,
        primaryRoleName: 'Compositor',
      });
    });

    it('sem papéis extras, sem consulta a papéis', async () => {
      prisma.composer.findUnique.mockResolvedValue(
        detailRow({ roles: null, bioGeneratedBy: null }),
      );
      const detail = await service.findOne(ID);
      expect(detail.roleNames).toEqual([]);
      expect(detail.bioGeneratedByAi).toBe(false);

      prisma.composer.findUnique.mockResolvedValue(detailRow({ roles: ' , ' }));
      expect((await service.findOne(ID)).roleNames).toEqual([]);
      expect(prisma.role.findMany).not.toHaveBeenCalled();
    });

    it('inexistente é 404; em cache não vai ao banco', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);
      await expect(service.findOne(ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      cache.get.mockResolvedValue({ id: 'cache' });
      await expect(service.findOne(ID)).resolves.toEqual({ id: 'cache' });
    });
  });

  describe('obras do compositor', () => {
    const workRow = {
      id: 'w1',
      title: 'Noturno',
      subtitle: '  ',
      opOrCatalog: 'Op. 9',
      compositionYear: null,
      tone: null,
      mediaDuration: null,
      imslpPermlink: null,
      videoUrl: null,
      moviment: null,
      workType: 'SINGLE',
      workGenresArr: null,
      categoryNames: null,
      isVerified: false,
      difficultyLevel: null,
      imslpTags: null,
      instrument: null,
    };

    it('pagina, filtra e informa se há mais', async () => {
      prisma.work.findMany.mockResolvedValue([workRow]);
      prisma.work.count.mockResolvedValue(3);

      const result = await service.findWorks(ID, {
        page: 1,
        limit: 1,
        instrumentId: 'i1',
        workGenresArr: 'Noturno',
        categoryNames: 'Piano',
        workType: 'SINGLE',
        difficultyLevel: 'ADVANCED',
        search: 'op.',
      });

      const [{ where }] = prisma.work.findMany.mock.calls[0];
      expect(where).toMatchObject({
        composerId: ID,
        instrumentId: 'i1',
        workGenresArr: { has: 'Noturno' },
        categoryNames: { has: 'Piano' },
        workType: 'SINGLE',
        difficultyLevel: 'ADVANCED',
      });
      expect(where.OR[0].title.contains).toBe('op\\.');
      expect(result).toMatchObject({
        totalCount: 3,
        hasMore: true,
        currentPage: 1,
      });
      expect(result.works[0]).toMatchObject({
        subtitle: undefined,
        instrument: undefined,
        workGenresArr: [],
        imslpTags: [],
      });
    });

    it('compositor inexistente é 404; em cache não conta de novo', async () => {
      prisma.composer.findUnique.mockResolvedValueOnce(null);
      await expect(service.findWorks(ID, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      cache.get.mockResolvedValue({ works: [] });
      await expect(service.findWorks(ID, {})).resolves.toEqual({ works: [] });
      expect(prisma.work.count).not.toHaveBeenCalled();
    });

    it('contagem por tipo de obra', async () => {
      prisma.work.groupBy.mockResolvedValue([
        { workType: 'SINGLE', _count: { workType: 5 } },
        { workType: 'COLLECTION', _count: { workType: 2 } },
      ]);

      await expect(service.getWorkTypeCounts(ID)).resolves.toEqual({
        workTypeCounts: { SINGLE: 5, COLLECTION: 2 },
        totalTypes: 2,
      });
    });

    it('opções de filtro deduplicadas e ordenadas', async () => {
      prisma.work.findMany.mockResolvedValue([
        {
          instrumentId: 'i2',
          instrument: { id: 'i2', name: 'Violino' },
          workGenresArr: ['Sonata', ' '],
          categoryNames: ['Cordas'],
        },
        {
          instrumentId: 'i1',
          instrument: { id: 'i1', name: 'Piano' },
          workGenresArr: [' Noturno ', 'Sonata'],
          categoryNames: null,
        },
        {
          instrumentId: null,
          instrument: null,
          workGenresArr: null,
          categoryNames: ['  '],
        },
      ]);

      const options = await service.getFilterOptions(ID);

      expect(options.instruments).toEqual([
        { id: 'i1', name: 'Piano' },
        { id: 'i2', name: 'Violino' },
      ]);
      expect(options.workGenres).toEqual(['Noturno', 'Sonata']);
      expect(options.categories).toEqual(['Cordas']);
      expect(options.difficultyLevels).toHaveLength(3);

      cache.get.mockResolvedValue({ instruments: [] });
      await expect(service.getFilterOptions(ID)).resolves.toEqual({
        instruments: [],
      });
    });
  });
});
