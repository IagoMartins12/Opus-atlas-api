import { NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InteractionsService, VIEW_WINDOW_MS } from './interactions.service';

const ARTICLE = '690273c1ecac0fb66b3844e7';
const USER = '690273c1ecac0fb66b3844bb';

const published = {
  status: 'PUBLISHED',
  publishedAt: new Date(Date.now() - 60_000),
  estimatedReadTime: 8,
};
const draft = { status: 'DRAFT', publishedAt: null, estimatedReadTime: 8 };

const anonymous = { ipAddress: '203.0.113.10', userAgent: 'Firefox' };

function makePrisma() {
  return {
    blogArticle: {
      findUnique: jest.fn().mockResolvedValue(published),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    blogLike: {
      count: jest.fn().mockResolvedValue(3),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    blogBookmark: {
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: Record<string, unknown>;
          update?: Record<string, unknown>;
        }) => Promise.resolve({ id: 'b1', ...create }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('InteractionsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: Map<string, unknown>;
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: InteractionsService;

  beforeEach(() => {
    prisma = makePrisma();
    store = new Map();
    cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    };
    service = new InteractionsService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  describe('visita', () => {
    // O legado somava um a cada chamada: um laço inflava qualquer matéria.
    it('o mesmo leitor conta uma vez na janela', async () => {
      const first = await service.registerView(ARTICLE, anonymous);
      const second = await service.registerView(ARTICLE, anonymous);

      expect(first.counted).toBe(true);
      expect(second.counted).toBe(false);
      expect(prisma.blogArticle.update).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^blog-view:/),
        1,
        VIEW_WINDOW_MS,
      );
    });

    it('outro leitor conta de novo', async () => {
      await service.registerView(ARTICLE, anonymous);
      await service.registerView(ARTICLE, {
        ...anonymous,
        userAgent: 'Safari',
      });

      expect(prisma.blogArticle.update).toHaveBeenCalledTimes(2);
    });

    // A chave de janela não pode cair na invalidação `blog:articles*`.
    it('a chave fica fora do namespace de cache dos artigos', async () => {
      await service.registerView(ARTICLE, { userId: USER });

      expect(cache.set.mock.calls[0][0]).not.toMatch(/^blog:articles/);
    });

    it('pré-visualização de rascunho não conta', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(draft);

      const result = await service.registerView(ARTICLE, anonymous);

      expect(result.counted).toBe(false);
      expect(prisma.blogArticle.update).not.toHaveBeenCalled();
    });

    it('sem conta nem IP, não conta', async () => {
      expect((await service.registerView(ARTICLE, {})).counted).toBe(false);
    });

    it('id malformado é 404', async () => {
      await expect(service.registerView('x', anonymous)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('leitura', () => {
    it('grava a média só se ninguém leu no meio', async () => {
      prisma.blogArticle.findUnique
        .mockResolvedValueOnce(published)
        .mockResolvedValueOnce({ readCount: 1, avgReadTime: 300 });

      const result = await service.registerRead(ARTICLE, anonymous, 500);

      expect(prisma.blogArticle.updateMany).toHaveBeenCalledWith({
        where: { id: ARTICLE, readCount: 1 },
        data: { readCount: { increment: 1 }, avgReadTime: 400 },
      });
      expect(result).toEqual({ success: true, counted: true, readCount: 2 });
    });

    // No legado, duas leituras ao mesmo tempo: uma sobrescrevia a outra.
    it('se outra leitura gravou no meio, recalcula e tenta de novo', async () => {
      prisma.blogArticle.findUnique
        .mockResolvedValueOnce(published)
        .mockResolvedValueOnce({ readCount: 1, avgReadTime: 300 })
        .mockResolvedValueOnce({ readCount: 2, avgReadTime: 400 });
      prisma.blogArticle.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const result = await service.registerRead(ARTICLE, anonymous, 400);

      expect(prisma.blogArticle.updateMany).toHaveBeenLastCalledWith({
        where: { id: ARTICLE, readCount: 2 },
        data: { readCount: { increment: 1 }, avgReadTime: 400 },
      });
      expect(result.readCount).toBe(3);
    });

    // Aba esquecida aberta não é leitura.
    it('limita o tempo a três vezes o estimado', async () => {
      prisma.blogArticle.findUnique
        .mockResolvedValueOnce(published)
        .mockResolvedValueOnce({ readCount: 0, avgReadTime: null });

      await service.registerRead(ARTICLE, anonymous, 4 * 60 * 60);

      expect(
        prisma.blogArticle.updateMany.mock.calls[0][0].data.avgReadTime,
      ).toBe(8 * 60 * 3);
    });

    it('o mesmo leitor conta uma leitura por dia', async () => {
      prisma.blogArticle.findUnique.mockImplementation(({ select }) =>
        Promise.resolve(
          select.readCount ? { readCount: 0, avgReadTime: null } : published,
        ),
      );

      await service.registerRead(ARTICLE, anonymous, 300);
      const second = await service.registerRead(ARTICLE, anonymous, 300);

      expect(second.counted).toBe(false);
      expect(prisma.blogArticle.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('curtir e salvar', () => {
    // O legado aceitava curtida em rascunho.
    it('não curte artigo que não está publicado', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(draft);

      await expect(service.like(ARTICLE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.blogLike.upsert).not.toHaveBeenCalled();
    });

    it('curtir devolve a contagem real', async () => {
      const result = await service.like(ARTICLE, USER);

      expect(result).toMatchObject({ liked: true, likesCount: 3 });
    });

    it('tirar a curtida vale mesmo para artigo despublicado', async () => {
      prisma.blogArticle.findUnique.mockResolvedValue(draft);

      await expect(service.unlike(ARTICLE, USER)).resolves.toMatchObject({
        liked: false,
      });
    });

    it('salvar grava a nota aparada, e nota vazia vira nula', async () => {
      await service.bookmark(ARTICLE, USER, '  reler o final  ');
      await service.bookmark(ARTICLE, USER, '   ');

      expect(prisma.blogBookmark.upsert.mock.calls[0][0].update).toEqual({
        notes: 'reler o final',
      });
      expect(prisma.blogBookmark.upsert.mock.calls[1][0].update).toEqual({
        notes: null,
      });
    });
  });

  describe('minhas listas', () => {
    // O legado mostrava o salvo despublicado, com o conteúdo inteiro.
    it('salvos: só artigos publicados', async () => {
      await service.myBookmarks(USER, {});

      expect(prisma.blogBookmark.findMany.mock.calls[0][0].where).toMatchObject(
        {
          userId: USER,
          article: { status: 'PUBLISHED' },
        },
      );
    });

    it('filtra por categoria, e "all" é todas', async () => {
      await service.myLikes(USER, { category: 'romantico' });
      await service.myLikes(USER, { category: 'all' });

      expect(
        prisma.blogLike.findMany.mock.calls[0][0].where.article,
      ).toMatchObject({
        categories: { some: { category: { slug: 'romantico' } } },
      });
      expect(
        prisma.blogLike.findMany.mock.calls[1][0].where.article,
      ).not.toHaveProperty('categories');
    });

    it('o cartão não traz o conteúdo do artigo', async () => {
      await service.myLikes(USER, {});

      const select =
        prisma.blogLike.findMany.mock.calls[0][0].select.article.select;
      expect(select).not.toHaveProperty('content');
    });

    it('formata categorias, tags e contagens', async () => {
      prisma.blogLike.findMany.mockResolvedValue([
        {
          id: 'l1',
          createdAt: new Date(),
          article: {
            id: ARTICLE,
            title: 'Chopin',
            categories: [{ category: { id: 'c', name: 'Romântico' } }],
            tags: [{ tag: { id: 't', name: 'chopin' } }],
            _count: { comments: 2, likes: 5 },
          },
        },
      ]);
      prisma.blogLike.count.mockResolvedValue(1);

      const { likes, pagination } = await service.myLikes(USER, {});

      expect(likes[0].article).toMatchObject({
        categories: [{ name: 'Romântico' }],
        tags: [{ name: 'chopin' }],
        stats: { comments: 2, likes: 5 },
      });
      expect(likes[0].article).not.toHaveProperty('_count');
      expect(pagination).toEqual({
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
      });
    });
  });

  it('resumo diz o que o leitor já fez', async () => {
    prisma.blogLike.findUnique.mockResolvedValue({ id: 'l1' });

    const result = await service.summary(ARTICLE, USER);

    expect(result).toEqual({
      success: true,
      likesCount: 3,
      bookmarksCount: 1,
      isLiked: true,
      isBookmarked: false,
    });
  });
});
