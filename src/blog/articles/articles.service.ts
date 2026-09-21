import { escapeRegex } from '../../common/utils/regex.util';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTHOR_SELECT, AUTHOR_SELECT_WITH_BIO } from '../dto/author-ref.dto';
import { CATEGORY_REF_SELECT } from '../dto/category-ref.dto';
import { TAG_REF_SELECT } from '../dto/tag-ref.dto';
import { cachedRead, cacheKey } from '../shared/cached-read';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto';

/** Id do Mongo; o que não for id é tratado como slug no detalhe. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const ARTICLE_LIST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  categories: { include: { category: { select: CATEGORY_REF_SELECT } } },
  tags: { include: { tag: { select: TAG_REF_SELECT } } },
  _count: { select: { comments: true, likes: true, bookmarks: true } },
} as const;

interface CurrentUserContext {
  sub: string;
  role: number;
}

type ArticleDetail = Awaited<ReturnType<ArticlesService['loadDetail']>>;

/**
 * Leitura pública do blog.
 *
 * **Com cache**, como o catálogo — o blog não tinha nenhum. O que depende de
 * quem pede nunca entra no cache: a lista de administrador (que mostra todos os
 * estados) é lida direto do banco, e no detalhe o "curtiu" e o "salvou" são
 * calculados por cima da parte comum. As escritas do blog já derrubam o
 * namespace `blog:articles`.
 */
@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async findAll(query: ListArticlesQueryDto, user?: CurrentUserContext) {
    const isAdmin = !!user && user.role >= 1;

    if (isAdmin) {
      return this.loadList(query, true);
    }

    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_ARTICLES, 'list', { ...query }),
      CacheTtl.MUTABLE,
      'blog/articles',
      () => this.loadList(query, false),
    );
  }

  async findFeatured() {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_ARTICLES, 'featured'),
      CacheTtl.MUTABLE,
      'blog/articles/featured',
      async () => {
        const articles = await this.prisma.blogArticle.findMany({
          where: { isFeatured: true },
          select: { id: true, title: true, featuredOrder: true },
          orderBy: { featuredOrder: 'asc' },
        });

        return { success: true, articles };
      },
    );
  }

  /**
   * Detalhe do artigo.
   *
   * A parte comum vem do cache — **só de artigo publicado**; rascunho é lido do
   * banco a cada vez. O "curtiu" e o "salvou" de quem pede são calculados
   * depois, **num objeto novo**: com o cache em memória, mexer no objeto
   * guardado vazaria a marcação de um leitor para o seguinte.
   */
  async findOne(id: string, user?: CurrentUserContext) {
    const key = cacheKey(CacheNamespace.BLOG_ARTICLES, 'detail', { id });
    const cached = await this.cache.get<ArticleDetail>(
      key,
      'blog/articles/detail',
    );
    const detail = cached ?? (await this.loadDetail(id));

    if (detail.article.status !== ArticleStatus.PUBLISHED) {
      const canSeeUnpublished =
        !!user && (user.role >= 1 || user.sub === detail.article.authorId);

      if (!canSeeUnpublished) {
        throw new ForbiddenException('Acesso negado');
      }
    } else if (!cached) {
      await this.cache.set(key, detail, CacheTtl.MUTABLE);
    }

    let userLiked = false;
    let userBookmarked = false;

    if (user) {
      const where = {
        articleId_userId: { articleId: detail.article.id, userId: user.sub },
      };
      const [like, bookmark] = await Promise.all([
        this.prisma.blogLike.findUnique({ where }),
        this.prisma.blogBookmark.findUnique({ where }),
      ]);

      userLiked = !!like;
      userBookmarked = !!bookmark;
    }

    return {
      ...detail,
      article: { ...detail.article, userLiked, userBookmarked },
    };
  }

  // -------------------------------------------------------------------

  private async loadList(query: ListArticlesQueryDto, isAdmin: boolean) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;

    const where: Prisma.BlogArticleWhereInput = {};

    if (!isAdmin) {
      where.status = ArticleStatus.PUBLISHED;
      where.publishedAt = { lte: new Date() };
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.types?.length) where.types = { hasSome: query.types };
    if (query.featured !== undefined) where.isFeatured = query.featured;
    if (query.composerId) where.composerIds = { has: query.composerId };
    if (query.workId) where.workIds = { has: query.workId };
    if (query.instrumentId) where.instrumentIds = { has: query.instrumentId };
    if (query.epochId) where.epochIds = { has: query.epochId };
    if (query.authorId) where.authorId = query.authorId;

    if (query.search) {
      where.OR = [
        { title: { contains: escapeRegex(query.search), mode: 'insensitive' } },
        {
          description: {
            contains: escapeRegex(query.search),
            mode: 'insensitive',
          },
        },
        { keywords: { hasSome: [query.search] } },
      ];
    }

    if (query.categories?.length) {
      where.categories = {
        some: { category: { slug: { in: query.categories } } },
      };
    }

    if (query.tags?.length) {
      where.tags = { some: { tag: { slug: { in: query.tags } } } };
    }

    const orderBy: Prisma.BlogArticleOrderByWithRelationInput =
      query.sortBy === 'oldest'
        ? { publishedAt: 'asc' }
        : query.sortBy === 'popular'
          ? { viewCount: 'desc' }
          : query.sortBy === 'mostRead'
            ? { readCount: 'desc' }
            : { publishedAt: 'desc' };

    const [articles, total] = await Promise.all([
      this.prisma.blogArticle.findMany({
        where,
        include: ARTICLE_LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogArticle.count({ where }),
    ]);

    return {
      success: true,
      articles: articles.map((article) => this.formatSummary(article)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * A parte do detalhe que é igual para todo leitor. Aceita o id ou o slug —
   * o endereço público do artigo é o slug (`/blog/:slug`).
   */
  private async loadDetail(idOrSlug: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: OBJECT_ID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
      include: {
        author: { select: AUTHOR_SELECT_WITH_BIO },
        categories: {
          include: {
            category: {
              select: { ...CATEGORY_REF_SELECT, description: true },
            },
          },
        },
        tags: { include: { tag: { select: TAG_REF_SELECT } } },
        media: { orderBy: { order: 'asc' } },
        _count: {
          select: {
            // O marcador "Comentário removido" não é comentário de ninguém.
            comments: {
              where: { status: 'APPROVED', NOT: { deletedAt: { not: null } } },
            },
            likes: true,
            bookmarks: true,
          },
        },
      },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const [composers, works, scores, instruments, epochs] = await Promise.all([
      article.composerIds.length
        ? this.prisma.composer.findMany({
            where: { id: { in: article.composerIds } },
            select: {
              id: true,
              name: true,
              fullName: true,
              portraitUrl: true,
              epochName: true,
              birthDate: true,
              deathDate: true,
            },
          })
        : Promise.resolve([]),
      article.workIds.length
        ? this.prisma.work.findMany({
            where: { id: { in: article.workIds } },
            select: {
              id: true,
              title: true,
              imslpId: true,
              opOrCatalog: true,
              composer: { select: { id: true, name: true } },
              instrument: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      article.scoreIds.length
        ? this.prisma.workScore.findMany({
            where: { sourceId: { in: article.scoreIds } },
            select: {
              id: true,
              sourceId: true,
              title: true,
              downloadUrl: true,
              type: true,
              thumbnailUrl: true,
              work: {
                select: {
                  id: true,
                  title: true,
                  composer: { select: { id: true, name: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      article.instrumentIds.length
        ? this.prisma.instrument.findMany({
            where: { id: { in: article.instrumentIds } },
            select: { id: true, name: true, category: true },
          })
        : Promise.resolve([]),
      article.epochIds.length
        ? this.prisma.epoch.findMany({
            where: { id: { in: article.epochIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const categoryIds = article.categories.map((c) => c.category.id);
    const tagIds = article.tags.map((t) => t.tag.id);

    const relatedArticles =
      categoryIds.length || tagIds.length
        ? await this.prisma.blogArticle.findMany({
            where: {
              id: { not: article.id },
              status: ArticleStatus.PUBLISHED,
              publishedAt: { lte: new Date() },
              OR: [
                ...(categoryIds.length
                  ? [
                      {
                        categories: {
                          some: { categoryId: { in: categoryIds } },
                        },
                      },
                    ]
                  : []),
                ...(tagIds.length
                  ? [{ tags: { some: { tagId: { in: tagIds } } } }]
                  : []),
              ],
            },
            select: {
              id: true,
              title: true,
              slug: true,
              description: true,
              coverImage: true,
              publishedAt: true,
              estimatedReadTime: true,
              viewCount: true,
            },
            orderBy: { viewCount: 'desc' },
            take: 4,
          })
        : [];

    return {
      success: true,
      article: {
        ...article,
        categories: article.categories.map((c) => c.category),
        tags: article.tags.map((t) => t.tag),
        backgroundMusic: {
          url: article.backgroundMusicUrl,
          title: article.backgroundMusicTitle,
          volume: article.backgroundMusicVolume ?? 0.3,
          loop: article.backgroundMusicLoop,
          autoplay: article.backgroundMusicAutoplay,
        },
        composers,
        works,
        scores,
        instruments,
        epochs,
        relatedArticles,
      },
      stats: {
        views: article.viewCount,
        reads: article.readCount,
        comments: article._count.comments,
        likes: article._count.likes,
        bookmarks: article._count.bookmarks,
      },
    };
  }

  private formatSummary(
    article: Prisma.BlogArticleGetPayload<{
      include: typeof ARTICLE_LIST_INCLUDE;
    }>,
  ) {
    return {
      ...article,
      categories: article.categories.map((c) => c.category),
      tags: article.tags.map((t) => t.tag),
      stats: {
        comments: article._count.comments,
        likes: article._count.likes,
        bookmarks: article._count.bookmarks,
      },
    };
  }
}
