import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from './search.service';

const article = {
  id: 'a1',
  title: 'Bach',
  categories: [{ category: { slug: 'historia' } }],
  tags: [{ tag: { slug: 'barroco' } }],
  _count: { comments: 3, likes: 7 },
};

describe('SearchService', () => {
  let prisma: {
    blogArticle: { findMany: jest.Mock; count: jest.Mock };
    blogTag: { findMany: jest.Mock };
    blogCategory: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    prisma = {
      blogArticle: {
        findMany: jest.fn().mockResolvedValue([article]),
        count: jest.fn().mockResolvedValue(13),
      },
      blogTag: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ name: 'barroco' }, { name: 'bach' }]),
      },
      blogCategory: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new SearchService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  it('público: só publicado, termo escapado, resultado achatado e em cache', async () => {
    const result = await service.searchArticles({ q: 'j.s.' } as never);

    const [{ where, orderBy, skip, take }] =
      prisma.blogArticle.findMany.mock.calls[0];
    expect(where.status).toBe('PUBLISHED');
    expect(where.OR[0].title.contains).toBe('j\\.s\\.');
    expect(orderBy).toEqual({ title: 'asc' });
    expect({ skip, take }).toEqual({ skip: 0, take: 12 });
    expect(result.results[0]).toMatchObject({
      categories: [{ slug: 'historia' }],
      tags: [{ slug: 'barroco' }],
      stats: { comments: 3, likes: 7 },
    });
    expect(result.pagination).toEqual({
      page: 1,
      limit: 12,
      total: 13,
      totalPages: 2,
    });
    expect(result.suggestions).toEqual(['barroco', 'bach']);
    expect(cache.set).toHaveBeenCalled();
  });

  it('admin vê todos os estados, direto do banco', async () => {
    await service.searchArticles({ q: 'x' } as never, { sub: 'u1', role: 1 });

    expect(
      prisma.blogArticle.findMany.mock.calls[0][0].where,
    ).not.toHaveProperty('status');
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('filtros e ordenações', async () => {
    await service.searchArticles({
      q: 'x',
      types: ['NEWS'],
      composerId: 'c1',
      workId: 'w1',
      categories: ['historia'],
      tags: ['barroco'],
      sortBy: 'newest',
      page: 2,
      limit: 5,
    } as never);
    const [{ where, orderBy, skip }] =
      prisma.blogArticle.findMany.mock.calls[0];
    expect(where).toMatchObject({
      types: { hasSome: ['NEWS'] },
      composerIds: { has: 'c1' },
      workIds: { has: 'w1' },
      categories: { some: { category: { slug: { in: ['historia'] } } } },
      tags: { some: { tag: { slug: { in: ['barroco'] } } } },
    });
    expect(orderBy).toEqual({ publishedAt: 'desc' });
    expect(skip).toBe(5);

    await service.searchArticles({ q: 'y', sortBy: 'popular' } as never);
    expect(prisma.blogArticle.findMany.mock.calls[1][0].orderBy).toEqual({
      viewCount: 'desc',
    });
  });

  it('autocompletar tudo, ou só um tipo', async () => {
    const all = await service.autocomplete({ q: 'ba' });
    expect(all.suggestions).toEqual({
      articles: [article],
      tags: [{ name: 'barroco' }, { name: 'bach' }],
      categories: [{ id: 'c1' }],
    });

    prisma.blogArticle.findMany.mockClear();
    const onlyTags = await service.autocomplete({ q: 'ba', type: 'tags' });
    expect(onlyTags.suggestions.articles).toEqual([]);
    expect(onlyTags.suggestions.categories).toEqual([]);
    expect(prisma.blogArticle.findMany).not.toHaveBeenCalled();
  });
});
