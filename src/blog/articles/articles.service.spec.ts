import { ForbiddenException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticlesService } from './articles.service';

const ID = '690273c1ecac0fb66b3844e7';

const detailRow = (status = 'PUBLISHED') => ({
  id: ID,
  status,
  authorId: 'autor',
  categories: [],
  tags: [],
  composerIds: [],
  workIds: [],
  scoreIds: [],
  instrumentIds: [],
  epochIds: [],
  backgroundMusicLoop: true,
  backgroundMusicAutoplay: true,
  viewCount: 1,
  readCount: 0,
  _count: { comments: 0, likes: 2, bookmarks: 0 },
});

describe('ArticlesService — cache', () => {
  let store: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let prisma: {
    blogArticle: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
    blogLike: { findUnique: jest.Mock };
    blogBookmark: { findUnique: jest.Mock };
  };
  let service: ArticlesService;

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
      blogArticle: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(detailRow()),
      },
      blogLike: { findUnique: jest.fn().mockResolvedValue({ id: 'l' }) },
      blogBookmark: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new ArticlesService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  it('a lista pública vem do cache na segunda vez', async () => {
    await service.findAll({ page: 1 });
    await service.findAll({ page: 1 });

    expect(prisma.blogArticle.findMany).toHaveBeenCalledTimes(1);
  });

  // O endereço público do artigo é o slug; o painel usa o id.
  it('o detalhe aceita o slug além do id', async () => {
    await service.findOne('tudo-sobre-sinfonia');
    await service.findOne(ID);

    expect(prisma.blogArticle.findUnique.mock.calls[0][0].where).toEqual({
      slug: 'tudo-sobre-sinfonia',
    });
    expect(prisma.blogArticle.findUnique.mock.calls[1][0].where).toEqual({
      id: ID,
    });
  });

  // A de administrador mostra todos os estados.
  it('a lista de administrador nunca entra no cache', async () => {
    await service.findAll({ page: 1 }, { sub: 'a', role: 1 });
    await service.findAll({ page: 1 }, { sub: 'a', role: 1 });

    expect(prisma.blogArticle.findMany).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
  });

  // Com o cache em memória, mexer no objeto guardado vazaria entre leitores.
  it('o "curtiu" de um leitor não vaza para o seguinte', async () => {
    const first = await service.findOne(ID, { sub: 'leitor-1', role: 0 });
    prisma.blogLike.findUnique.mockResolvedValue(null);
    const second = await service.findOne(ID);

    expect(first.article.userLiked).toBe(true);
    expect(second.article.userLiked).toBe(false);
    expect(prisma.blogArticle.findUnique).toHaveBeenCalledTimes(1);
    expect(
      (store.values().next().value as { article: object }).article,
    ).not.toHaveProperty('userLiked');
  });

  it('rascunho não entra no cache, e continua fechado para o público', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue(detailRow('DRAFT'));

    await expect(service.findOne(ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cache.set).not.toHaveBeenCalled();
  });
});
