import { AppCacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { SeoService } from './seo.service';

describe('SeoService', () => {
  const updatedAt = new Date('2026-09-01T00:00:00Z');
  let prisma: Record<string, { findMany?: jest.Mock; groupBy?: jest.Mock }>;
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
        findMany: jest.fn().mockResolvedValue([{ slug: 'chopin', updatedAt }]),
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
});
