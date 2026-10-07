import { NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthorsService } from './authors.service';

const ID = '690273c1ecac0fb66b3844e7';

const autor = {
  id: ID,
  firstName: 'Helena',
  lastName: 'Prado',
  username: 'helena-prado',
  image: null,
  bio: 'Cravista.',
};

const categoria = (id: string, name: string, isActive = true) => ({
  category: { id, name, slug: name.toLowerCase(), isActive },
});

describe('AuthorsService', () => {
  let store: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let prisma: {
    user: { findFirst: jest.Mock };
    blogArticle: { aggregate: jest.Mock; findMany: jest.Mock };
  };
  let service: AuthorsService;

  beforeEach(() => {
    store = new Map();
    cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    };
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(autor) },
      blogArticle: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 3 },
          _sum: { viewCount: 120 },
          _min: { publishedAt: new Date('2026-07-01') },
          _max: { publishedAt: new Date('2026-09-28') },
        }),
        findMany: jest.fn().mockResolvedValue([
          { categories: [categoria('h', 'História')] },
          {
            categories: [
              categoria('h', 'História'),
              categoria('c', 'Compositores'),
            ],
          },
          { categories: [categoria('x', 'Desativada', false)] },
        ]),
      },
    };
    service = new AuthorsService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  it('procura pelo nome de usuário quando o endereço não é id', async () => {
    await service.findOne('helena-prado');

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'helena-prado' } }),
    );
  });

  it('aceita o id, e também o nome de usuário que pareça id', async () => {
    await service.findOne(ID);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: ID }, { username: ID }] },
      }),
    );
  });

  it('só conta artigos publicados e já no ar', async () => {
    await service.findOne('helena-prado');

    const { where } = prisma.blogArticle.aggregate.mock.calls[0][0];
    expect(where).toMatchObject({ authorId: ID, status: 'PUBLISHED' });
    expect(where.publishedAt.lte).toBeInstanceOf(Date);
  });

  it('conta as categorias ativas, da mais usada à menos', async () => {
    const perfil = await service.findOne('helena-prado');

    expect(perfil.categories).toEqual([
      { id: 'h', name: 'História', slug: 'história', articles: 2 },
      { id: 'c', name: 'Compositores', slug: 'compositores', articles: 1 },
    ]);
    expect(perfil.stats).toMatchObject({ articles: 3, views: 120 });
  });

  it('conta inexistente é 404', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.findOne('ninguem')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('conta sem artigo publicado também é 404: a rota não lista contas', async () => {
    prisma.blogArticle.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { viewCount: null },
      _min: { publishedAt: null },
      _max: { publishedAt: null },
    });

    await expect(service.findOne('helena-prado')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a segunda leitura vem do cache, numa chave do namespace dos artigos', async () => {
    await service.findOne('helena-prado');
    await service.findOne('helena-prado');

    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0][0]).toMatch(/^blog:articles:author:/);
  });
});
