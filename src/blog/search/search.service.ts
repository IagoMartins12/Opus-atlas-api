import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable } from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { cachedRead, cacheKey } from '../shared/cached-read';
import { AUTHOR_SELECT } from '../dto/author-ref.dto';
import { CATEGORY_REF_SELECT } from '../dto/category-ref.dto';
import { TAG_REF_SELECT } from '../dto/tag-ref.dto';
import {
  AutocompleteQueryDto,
  SearchArticlesQueryDto,
} from './dto/search-articles-query.dto';

interface CurrentUserContext {
  sub: string;
  role: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Busca de artigos. Com cache para o público; a de administrador, que vê
   * todos os estados, é lida do banco.
   */
  async searchArticles(
    query: SearchArticlesQueryDto,
    user?: CurrentUserContext,
  ) {
    if (user && user.role >= 1) {
      return this.loadSearch(query, user);
    }

    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_ARTICLES, 'search', { ...query }),
      CacheTtl.MUTABLE,
      'blog/search',
      () => this.loadSearch(query),
    );
  }

  async autocomplete(query: {
    q: string;
    type?: AutocompleteQueryDto['type'];
  }) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_ARTICLES, 'autocomplete', { ...query }),
      CacheTtl.MUTABLE,
      'blog/search/autocomplete',
      () => this.loadAutocomplete(query),
    );
  }

  private async loadSearch(
    query: SearchArticlesQueryDto,
    user?: CurrentUserContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const isAdmin = !!user && user.role >= 1;

    const where: Prisma.BlogArticleWhereInput = {
      OR: [
        { title: { contains: escapeRegex(query.q), mode: 'insensitive' } },
        {
          description: { contains: escapeRegex(query.q), mode: 'insensitive' },
        },
        { keywords: { hasSome: [query.q] } },
      ],
    };

    if (!isAdmin) {
      where.status = ArticleStatus.PUBLISHED;
      where.publishedAt = { lte: new Date() };
    }

    if (query.types?.length) where.types = { hasSome: query.types };
    if (query.composerId) where.composerIds = { has: query.composerId };
    if (query.workId) where.workIds = { has: query.workId };
    if (query.categories?.length) {
      where.categories = {
        some: { category: { slug: { in: query.categories } } },
      };
    }
    if (query.tags?.length) {
      where.tags = { some: { tag: { slug: { in: query.tags } } } };
    }

    const orderBy: Prisma.BlogArticleOrderByWithRelationInput =
      query.sortBy === 'newest'
        ? { publishedAt: 'desc' }
        : query.sortBy === 'popular'
          ? { viewCount: 'desc' }
          : // Relevância "de verdade" exigiria full-text search (fora de escopo aqui);
            // ordenar por título é a mesma simplificação que já existia no legado.
            { title: 'asc' };

    const [articles, total, relatedTags] = await Promise.all([
      this.prisma.blogArticle.findMany({
        where,
        include: {
          author: { select: AUTHOR_SELECT },
          categories: {
            include: { category: { select: CATEGORY_REF_SELECT } },
          },
          tags: { include: { tag: { select: TAG_REF_SELECT } } },
          _count: {
            select: {
              comments: { where: { status: 'APPROVED' } },
              likes: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogArticle.count({ where }),
      this.prisma.blogTag.findMany({
        where: {
          name: { contains: escapeRegex(query.q), mode: 'insensitive' },
        },
        orderBy: { articleCount: 'desc' },
        take: 5,
        select: { name: true },
      }),
    ]);

    return {
      success: true,
      query: query.q,
      results: articles.map((article) => ({
        ...article,
        categories: article.categories.map((c) => c.category),
        tags: article.tags.map((t) => t.tag),
        stats: {
          comments: article._count.comments,
          likes: article._count.likes,
        },
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      suggestions: relatedTags.map((t) => t.name).slice(0, 5),
    };
  }

  private async loadAutocomplete(query: {
    q: string;
    type?: AutocompleteQueryDto['type'];
  }) {
    const { q, type = 'all' } = query;

    const [articles, tags, categories] = await Promise.all([
      type === 'articles' || type === 'all'
        ? this.prisma.blogArticle.findMany({
            where: {
              status: ArticleStatus.PUBLISHED,
              publishedAt: { lte: new Date() },
              title: { contains: escapeRegex(q), mode: 'insensitive' },
            },
            select: { id: true, title: true, slug: true, coverImage: true },
            orderBy: { viewCount: 'desc' },
            take: 5,
          })
        : Promise.resolve([]),
      type === 'tags' || type === 'all'
        ? this.prisma.blogTag.findMany({
            where: { name: { contains: escapeRegex(q), mode: 'insensitive' } },
            select: {
              id: true,
              name: true,
              slug: true,
              color: true,
              articleCount: true,
            },
            orderBy: { articleCount: 'desc' },
            take: 5,
          })
        : Promise.resolve([]),
      type === 'categories' || type === 'all'
        ? this.prisma.blogCategory.findMany({
            where: { name: { contains: escapeRegex(q), mode: 'insensitive' } },
            select: {
              id: true,
              name: true,
              slug: true,
              icon: true,
              color: true,
            },
            orderBy: { order: 'asc' },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    return {
      success: true,
      query: q,
      suggestions: { articles, tags, categories },
    };
  }
}
