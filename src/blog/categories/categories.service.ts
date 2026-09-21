import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { cachedRead, cacheKey } from '../shared/cached-read';
import { ArticlesService } from '../articles/articles.service';
import { TaxonomyArticlesQueryDto } from '../dto/taxonomy-articles-query.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly articles: ArticlesService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Artigos publicados de uma categoria.
   *
   * **A rota do legado nunca funcionou.** Ela consultava a tabela de junção
   * (`BlogArticleCategory`) com `orderBy: { publishedAt }` — e a junção não tem
   * esse campo, só `articleId`, `categoryId` e `createdAt`. O Prisma recusa a
   * consulta, e toda chamada voltava 500, em qualquer ordenação. Depois ainda
   * reordenava em memória a página já cortada, o que também estaria errado.
   *
   * Aqui não há consulta nova: é a listagem de `GET /blog/articles`, que já
   * filtra por slug de categoria, ordena no banco e pagina.
   */
  async findArticles(slug: string, query: TaxonomyArticlesQueryDto) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Categoria não encontrada');
    }

    return this.articles.findAll({
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      categories: [slug],
    });
  }

  async findAll(includeCount: boolean, parentId?: string) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_CATEGORIES, 'list', {
        includeCount,
        parentId,
      }),
      CacheTtl.MUTABLE,
      'blog/categories',
      () => this.loadAll(includeCount, parentId),
    );
  }

  async findBySlug(slug: string) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_CATEGORIES, 'slug', { slug }),
      CacheTtl.MUTABLE,
      'blog/categories/slug',
      () => this.loadBySlug(slug),
    );
  }

  private async loadAll(includeCount: boolean, parentId?: string) {
    const where: Record<string, unknown> = {};

    if (parentId === 'null') {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId;
    }

    const categories = await this.prisma.blogCategory.findMany({
      where,
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          select: { id: true, name: true, slug: true, icon: true, color: true },
          orderBy: { order: 'asc' },
        },
        ...(includeCount
          ? {
              articles: {
                where: { article: { status: 'PUBLISHED' } },
                select: { id: true },
              },
            }
          : {}),
      },
      orderBy: { order: 'asc' },
    });

    return {
      success: true,
      categories: categories.map(({ articles, ...category }) => ({
        ...category,
        articleCount: includeCount ? (articles?.length ?? 0) : undefined,
      })),
    };
  }

  private async loadBySlug(slug: string) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { slug },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
            color: true,
            description: true,
          },
          orderBy: { order: 'asc' },
        },
        articles: {
          where: {
            article: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
          },
          select: { id: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Categoria não encontrada');
    }

    return {
      success: true,
      category: {
        ...category,
        articleCount: category.articles.length,
        articles: undefined,
      },
    };
  }
}
