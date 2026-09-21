import { AppCacheService } from '../../common/cache/cache.service';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticlesService } from '../articles/articles.service';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';

// As duas rotas do legado ordenavam a tabela de junção por um campo que ela
// não tem: toda chamada voltava 500. Aqui elas delegam à listagem de artigos.
describe('artigos por categoria e por tag', () => {
  const page = { success: true, articles: [], pagination: {} };
  let articles: { findAll: jest.Mock };

  beforeEach(() => {
    articles = { findAll: jest.fn().mockResolvedValue(page) };
  });

  describe('categoria', () => {
    const make = (found: object | null) =>
      new CategoriesService(
        {
          blogCategory: { findUnique: jest.fn().mockResolvedValue(found) },
        } as unknown as PrismaService,
        articles as unknown as ArticlesService,
        {
          get: jest.fn().mockResolvedValue(undefined),
          set: jest.fn(),
          invalidateMany: jest.fn(),
        } as unknown as AppCacheService,
      );

    it('delega à listagem, filtrando pelo slug', async () => {
      const result = await make({ id: 'c' }).findArticles('romantico', {
        page: 2,
        limit: 6,
        sortBy: 'popular',
      });

      expect(articles.findAll).toHaveBeenCalledWith({
        page: 2,
        limit: 6,
        sortBy: 'popular',
        categories: ['romantico'],
      });
      expect(result).toBe(page);
    });

    // Sem usuário: a listagem só devolve publicados.
    it('não repassa usuário, então só vêm publicados', async () => {
      await make({ id: 'c' }).findArticles('romantico', {});

      expect(articles.findAll.mock.calls[0]).toHaveLength(1);
    });

    it('categoria inexistente é 404, sem listar', async () => {
      await expect(make(null).findArticles('nada', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(articles.findAll).not.toHaveBeenCalled();
    });
  });

  describe('tag', () => {
    const make = (found: object | null) =>
      new TagsService(
        {
          blogTag: { findUnique: jest.fn().mockResolvedValue(found) },
        } as unknown as PrismaService,
        articles as unknown as ArticlesService,
        {
          get: jest.fn().mockResolvedValue(undefined),
          set: jest.fn(),
          invalidateMany: jest.fn(),
        } as unknown as AppCacheService,
      );

    it('delega à listagem, filtrando pelo slug', async () => {
      await make({ id: 't' }).findArticles('chopin', { page: 1, limit: 12 });

      expect(articles.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 12,
        sortBy: undefined,
        tags: ['chopin'],
      });
    });

    it('tag inexistente é 404', async () => {
      await expect(make(null).findArticles('nada', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
