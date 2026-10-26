import { AppCacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { SeoService } from './seo.service';

describe('SeoService', () => {
  const updatedAt = new Date('2026-09-01T00:00:00Z');
  let prisma: Record<
    string,
    { findMany?: jest.Mock; groupBy?: jest.Mock; count?: jest.Mock }
  >;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: SeoService;

  beforeEach(() => {
    prisma = {
      composer: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'c1', fullName: '', name: 'Bach', updatedAt },
          ]),
      },
      work: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'w1', title: 'Noturno', updatedAt }]),
      },
      favoriteWork: {
        groupBy: jest.fn().mockResolvedValue([{ workId: 'w1', _count: {} }]),
      },
      annotation: { groupBy: jest.fn().mockResolvedValue([]) },
      blogArticle: {
        findMany: jest.fn().mockResolvedValue([
          {
            slug: 'chopin',
            updatedAt,
            authorId: 'a1',
            categories: [
              { category: { slug: 'historia', isActive: true } },
              { category: { slug: 'desligada', isActive: false } },
            ],
            tags: [{ tag: { slug: 'piano' } }],
          },
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'a1', username: 'helena-prado' }]),
      },
      teacher: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', updatedAt }]),
      },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new SeoService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  // O legado não listava o blog nem os professores.
  it('inclui matérias publicadas e professores públicos', async () => {
    const result = await service.sitemapEntries();

    expect(result.articles).toEqual([
      { slug: 'chopin', lastModified: updatedAt },
    ]);
    // O id público do professor é o do usuário.
    expect(result.teachers).toEqual([{ id: 'u1', lastModified: updatedAt }]);
    expect(prisma.blogArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('lista as categorias ativas, as tags e os autores do blog', async () => {
    const result = await service.sitemapEntries();

    expect(result.blogCategories).toEqual([
      { slug: 'historia', lastModified: updatedAt },
    ]);
    expect(result.blogTags).toEqual([
      { slug: 'piano', lastModified: updatedAt },
    ]);
    // O endereço público do autor é o nome de usuário.
    expect(result.blogAuthors).toEqual([
      { id: 'helena-prado', lastModified: updatedAt },
    ]);
  });

  it('compositor sem nome completo usa o nome', async () => {
    const result = await service.sitemapEntries();
    expect(result.composers[0].name).toBe('Bach');
  });

  it('segunda leitura vem do cache', async () => {
    cache.get.mockResolvedValue({ composers: [] });

    await service.sitemapEntries();

    expect(prisma.composer.findMany).not.toHaveBeenCalled();
  });

  // Ordenar 207 mil obras pela contagem de favoritos estourava o tempo (408).
  it('obras populares vêm da contagem nas coleções de favorito e anotação', async () => {
    const result = await service.sitemapEntries();

    expect(prisma.favoriteWork.groupBy).toHaveBeenCalled();
    expect(result.works[0]).toMatchObject({ id: 'w1', title: 'Noturno' });
  });

  describe('sitemap do acervo inteiro', () => {
    it('conta as páginas: compositores com obra e obras principais, 40 mil por arquivo', async () => {
      prisma.work.groupBy = jest
        .fn()
        .mockResolvedValue([{ composerId: 'b' }, { composerId: 'a' }]);
      prisma.work.count = jest.fn().mockResolvedValue(85_000);

      await expect(service.catalogIndex()).resolves.toEqual({
        pageSize: 40_000,
        composers: 1,
        works: 3,
      });
      // Os movimentos ficam de fora: a obra mãe os lista.
      expect(prisma.work.count).toHaveBeenCalledWith({
        where: {
          OR: [{ parentWorkId: null }, { parentWorkId: { isSet: false } }],
        },
      });
    });

    it('uma página de obras vem em ordem de id, a partir do lugar dela', async () => {
      await service.catalogPage('works', 2);

      expect(prisma.work.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { id: 'asc' },
          skip: 80_000,
          take: 40_000,
        }),
      );
    });

    it('a página de compositores só traz quem tem obra', async () => {
      prisma.work.groupBy = jest
        .fn()
        .mockResolvedValue([{ composerId: 'c2' }, { composerId: 'c1' }]);

      await service.catalogPage('composers', 0);

      expect(prisma.composer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['c1', 'c2'] } } }),
      );
    });
  });
});
