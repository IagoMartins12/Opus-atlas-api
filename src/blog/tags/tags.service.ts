import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { cachedRead, cacheKey } from '../shared/cached-read';
import { ArticlesService } from '../articles/articles.service';
import { TaxonomyArticlesQueryDto } from '../dto/taxonomy-articles-query.dto';
import { ListTagsQueryDto } from './dto/list-tags-query.dto';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly articles: ArticlesService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Artigos publicados de uma tag.
   *
   * A rota do legado era cópia da de categoria, com o mesmo defeito: ordenava a
   * junção (`BlogArticleTag`) por um campo que ela não tem, e toda chamada
   * voltava 500. Aqui é a listagem de `GET /blog/articles`, filtrada.
   */
  async findArticles(slug: string, query: TaxonomyArticlesQueryDto) {
    const tag = await this.prisma.blogTag.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!tag) {
      throw new NotFoundException('Tag não encontrada');
    }

    return this.articles.findAll({
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      tags: [slug],
    });
  }

  async findAll(query: ListTagsQueryDto) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_TAGS, 'list', { ...query }),
      CacheTtl.MUTABLE,
      'blog/tags',
      () => this.loadAll(query),
    );
  }

  async findBySlug(slug: string) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_TAGS, 'slug', { slug }),
      CacheTtl.MUTABLE,
      'blog/tags/slug',
      () => this.loadBySlug(slug),
    );
  }

  private async loadAll(query: ListTagsQueryDto) {
    const where: Prisma.BlogTagWhereInput = query.search
      ? { name: { contains: escapeRegex(query.search), mode: 'insensitive' } }
      : {};

    const orderBy: Prisma.BlogTagOrderByWithRelationInput =
      query.sortBy === 'alphabetical'
        ? { name: 'asc' }
        : query.sortBy === 'recent'
          ? { createdAt: 'desc' }
          : { articleCount: 'desc' };

    const tags = await this.prisma.blogTag.findMany({
      where,
      orderBy,
      take: query.limit ?? 50,
    });

    return { success: true, tags };
  }

  private async loadBySlug(slug: string) {
    const tag = await this.prisma.blogTag.findUnique({ where: { slug } });

    if (!tag) {
      throw new NotFoundException('Tag não encontrada');
    }

    return { success: true, tag };
  }
}
