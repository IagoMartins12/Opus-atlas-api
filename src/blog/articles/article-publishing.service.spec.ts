import { NotFoundException } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticlePublishingService } from './article-publishing.service';

const ID = '690273c1ecac0fb66b3844e7';
const OTHER = '690273c1ecac0fb66b3844e8';

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

function makePrisma() {
  const prisma = {
    blogArticle: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: ID }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );

  return prisma;
}

describe('ArticlePublishingService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let cache: { invalidateMany: jest.Mock };
  let service: ArticlePublishingService;

  beforeEach(() => {
    prisma = makePrisma();
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    service = new ArticlePublishingService(
      prisma as unknown as PrismaService,
      cache as unknown as AppCacheService,
    );
  });

  const updateData = () => prisma.blogArticle.update.mock.calls[0][0].data;

  describe('publish', () => {
    beforeEach(() => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        status: ArticleStatus.PUBLISHED,
        publishedAt: yesterday,
        scheduledFor: null,
      });
    });

    it('despublicar tira as duas datas', async () => {
      await service.publish(ID, 'unpublish');

      expect(updateData()).toEqual({
        status: ArticleStatus.DRAFT,
        publishedAt: null,
        scheduledFor: null,
      });
    });

    it('agendar para o futuro', async () => {
      await service.publish(ID, 'schedule', tomorrow.toISOString());

      expect(updateData()).toMatchObject({
        status: ArticleStatus.SCHEDULED,
        scheduledFor: tomorrow,
      });
    });

    it('agendar para o passado é recusado, sem gravar', async () => {
      await expect(
        service.publish(ID, 'schedule', yesterday.toISOString()),
      ).rejects.toThrow(/já passou/);

      expect(prisma.blogArticle.update).not.toHaveBeenCalled();
    });

    it('republicar mantém a data', async () => {
      await service.publish(ID, 'publish');

      expect(updateData().publishedAt).toBe(yesterday);
    });
  });

  // O legado redirecionava; aqui o front recebe o slug.
  it('aprovar devolve o slug para o front navegar', async () => {
    prisma.blogArticle.findUnique.mockResolvedValue({
      status: ArticleStatus.REVIEW,
      publishedAt: null,
      scheduledFor: null,
    });

    await service.approve(ID);

    expect(prisma.blogArticle.update.mock.calls[0][0]).toMatchObject({
      data: { status: ArticleStatus.PUBLISHED },
      select: { slug: true },
    });
  });

  it('id malformado é 404', async () => {
    await expect(service.publish('x', 'publish')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('feature', () => {
    beforeEach(() => {
      prisma.blogArticle.findUnique.mockResolvedValue({
        id: ID,
        isFeatured: false,
        featuredOrder: null,
      });
    });

    // O legado dava posição 1 a todo artigo novo no carrossel.
    it('entra na menor posição livre', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { featuredOrder: 1 },
        { featuredOrder: 3 },
      ]);

      await service.feature(ID, true);

      expect(updateData()).toEqual({ isFeatured: true, featuredOrder: 2 });
    });

    it('respeita o teto', async () => {
      prisma.blogArticle.findMany.mockResolvedValue(
        [1, 2, 3, 4, 5].map((featuredOrder) => ({ featuredOrder })),
      );

      await expect(service.feature(ID, true)).rejects.toThrow(/Limite de 5/);
    });

    it('sair do destaque apaga a posição', async () => {
      await service.feature(ID, false);

      expect(updateData()).toEqual({ isFeatured: false, featuredOrder: null });
    });
  });

  describe('reorderFeatured', () => {
    it('recusa artigo repetido', async () => {
      await expect(
        service.reorderFeatured([
          { id: ID, featuredOrder: 1 },
          { id: ID, featuredOrder: 2 },
        ]),
      ).rejects.toThrow(/duas vezes/);
    });

    it('recusa posição repetida', async () => {
      await expect(
        service.reorderFeatured([
          { id: ID, featuredOrder: 1 },
          { id: OTHER, featuredOrder: 1 },
        ]),
      ).rejects.toThrow(/posições iguais/);
    });

    // O legado dava posição no carrossel a artigo que não estava nele.
    it('recusa artigo fora do destaque, sem gravar nenhuma posição', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { id: ID, isFeatured: true },
        { id: OTHER, isFeatured: false },
      ]);

      await expect(
        service.reorderFeatured([
          { id: ID, featuredOrder: 2 },
          { id: OTHER, featuredOrder: 1 },
        ]),
      ).rejects.toThrow(OTHER);

      expect(prisma.blogArticle.update).not.toHaveBeenCalled();
    });

    it('grava as posições numa transação', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { id: ID, isFeatured: true },
        { id: OTHER, isFeatured: true },
      ]);

      await service.reorderFeatured([
        { id: ID, featuredOrder: 2 },
        { id: OTHER, featuredOrder: 1 },
      ]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.blogArticle.update).toHaveBeenCalledTimes(2);
    });
  });

  // No legado, agendado nunca era publicado.
  describe('publishDue', () => {
    const now = new Date();

    it('publica com a data agendada, só se o estado lido não mudou', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { id: ID, title: 'A', scheduledFor: yesterday },
      ]);

      const result = await service.publishDue(now);

      expect(prisma.blogArticle.findMany.mock.calls[0][0].where).toEqual({
        status: ArticleStatus.SCHEDULED,
        scheduledFor: { lte: now },
      });
      expect(prisma.blogArticle.updateMany).toHaveBeenCalledWith({
        where: {
          id: ID,
          status: ArticleStatus.SCHEDULED,
          scheduledFor: yesterday,
        },
        data: {
          status: ArticleStatus.PUBLISHED,
          publishedAt: yesterday,
          scheduledFor: null,
        },
      });
      expect(result).toEqual({ due: 1, published: 1 });
      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    // Reagendado ou despublicado entre a consulta e a gravação.
    it('artigo que mudou no meio não é publicado', async () => {
      prisma.blogArticle.findMany.mockResolvedValue([
        { id: ID, title: 'A', scheduledFor: yesterday },
      ]);
      prisma.blogArticle.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.publishDue(now)).toEqual({ due: 1, published: 0 });
      expect(cache.invalidateMany).not.toHaveBeenCalled();
    });

    it('sem agendados vencidos, não faz nada', async () => {
      expect(await service.publishDue(now)).toEqual({ due: 0, published: 0 });
      expect(prisma.blogArticle.updateMany).not.toHaveBeenCalled();
      expect(cache.invalidateMany).not.toHaveBeenCalled();
    });
  });
});
