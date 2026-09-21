import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTHOR_SELECT } from '../dto/author-ref.dto';
import { CATEGORY_REF_SELECT } from '../dto/category-ref.dto';
import { TAG_REF_SELECT } from '../dto/tag-ref.dto';
import { SavedArticlesQueryDto } from './dto/interactions.dto';
import { clampReadSeconds, nextAverage } from './read-time';
import { ViewerIdentity, viewerKey } from '../../common/utils/viewer-key';

/** Janela em que o mesmo leitor conta uma visita só. */
export const VIEW_WINDOW_MS = 30 * 60 * 1000;

/** Janela em que o mesmo leitor conta uma leitura só. */
export const READ_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Tentativas da média de leitura quando outra leitura grava no meio. */
const AVERAGE_ATTEMPTS = 3;

/** Comentário que conta: no ar, e que não é o marcador "Comentário removido". */
const VISIBLE_COMMENTS = {
  status: 'APPROVED',
  NOT: { deletedAt: { not: null } },
} as const;

/**
 * O cartão do artigo nas listas "curtidos" e "salvos".
 *
 * **Sem o conteúdo.** O legado devolvia o artigo inteiro em cada item — o JSON
 * do editor tem até 60 KB por matéria —, para uma tela que mostra título, capa
 * e resumo.
 */
const ARTICLE_CARD_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImage: true,
  coverImageAlt: true,
  types: true,
  publishedAt: true,
  estimatedReadTime: true,
  readTime: true,
  viewCount: true,
  author: { select: AUTHOR_SELECT },
  categories: { select: { category: { select: CATEGORY_REF_SELECT } } },
  tags: { select: { tag: { select: TAG_REF_SELECT } } },
  _count: { select: { comments: { where: VISIBLE_COMMENTS }, likes: true } },
} as const;

type ArticleCard = Prisma.BlogArticleGetPayload<{
  select: typeof ARTICLE_CARD_SELECT;
}>;

/**
 * Interações de quem lê com o artigo: curtir, salvar, visita e leitura.
 */
@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  /** Contagens do artigo e, com sessão, o que o leitor já fez. */
  async summary(articleId: string, userId?: string) {
    await this.requireArticle(articleId);

    const key = userId ? { articleId_userId: { articleId, userId } } : null;

    const [likesCount, bookmarksCount, like, bookmark] = await Promise.all([
      this.prisma.blogLike.count({ where: { articleId } }),
      this.prisma.blogBookmark.count({ where: { articleId } }),
      key
        ? this.prisma.blogLike.findUnique({ where: key, select: { id: true } })
        : null,
      key
        ? this.prisma.blogBookmark.findUnique({
            where: key,
            select: { id: true },
          })
        : null,
    ]);

    return {
      success: true,
      likesCount,
      bookmarksCount,
      isLiked: !!like,
      isBookmarked: !!bookmark,
    };
  }

  /**
   * Curte. Só artigo publicado — o legado aceitava curtida em rascunho, que o
   * leitor nem deveria conseguir abrir.
   */
  async like(articleId: string, userId: string) {
    await this.requirePublished(articleId);

    await this.prisma.blogLike.upsert({
      where: { articleId_userId: { articleId, userId } },
      create: { articleId, userId },
      update: {},
    });

    return {
      success: true,
      liked: true,
      likesCount: await this.prisma.blogLike.count({ where: { articleId } }),
      message: 'Artigo curtido',
    };
  }

  /** Tira a curtida. Vale para qualquer artigo, publicado ou não. */
  async unlike(articleId: string, userId: string) {
    await this.requireArticle(articleId);

    await this.prisma.blogLike.deleteMany({ where: { articleId, userId } });

    return {
      success: true,
      liked: false,
      likesCount: await this.prisma.blogLike.count({ where: { articleId } }),
      message: 'Curtida removida',
    };
  }

  async bookmark(articleId: string, userId: string, notes?: string | null) {
    await this.requirePublished(articleId);

    const note = notes?.trim() || null;

    const bookmark = await this.prisma.blogBookmark.upsert({
      where: { articleId_userId: { articleId, userId } },
      create: { articleId, userId, notes: note },
      update: { notes: note },
    });

    return { success: true, bookmark, message: 'Artigo salvo' };
  }

  async unbookmark(articleId: string, userId: string) {
    await this.requireArticle(articleId);

    await this.prisma.blogBookmark.deleteMany({ where: { articleId, userId } });

    return { success: true, message: 'Salvamento removido' };
  }

  async myLikes(userId: string, query: SavedArticlesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where: Prisma.BlogLikeWhereInput = {
      userId,
      article: publishedArticleFilter(query.category),
    };

    const [likes, total] = await Promise.all([
      this.prisma.blogLike.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          article: { select: ARTICLE_CARD_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogLike.count({ where }),
    ]);

    return {
      success: true,
      likes: likes.map((like) => ({ ...like, article: card(like.article) })),
      pagination: paginationOf(page, limit, total),
    };
  }

  /**
   * Artigos salvos.
   *
   * **Só os publicados.** O legado não filtrava: um artigo salvo quando estava
   * no ar e depois despublicado continuava aparecendo — com o conteúdo inteiro
   * — para quem o tinha salvo. O salvamento fica guardado; se o artigo voltar
   * ao ar, ele volta à lista.
   */
  async myBookmarks(userId: string, query: SavedArticlesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where: Prisma.BlogBookmarkWhereInput = {
      userId,
      article: publishedArticleFilter(query.category),
    };

    const [bookmarks, total] = await Promise.all([
      this.prisma.blogBookmark.findMany({
        where,
        select: {
          id: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          article: { select: ARTICLE_CARD_SELECT },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blogBookmark.count({ where }),
    ]);

    return {
      success: true,
      bookmarks: bookmarks.map((bookmark) => ({
        ...bookmark,
        article: card(bookmark.article),
      })),
      pagination: paginationOf(page, limit, total),
    };
  }

  /**
   * Registra uma visita — **uma por leitor a cada 30 minutos.**
   *
   * O legado somava um a cada `POST`, sem autenticação e sem nenhuma
   * deduplicação: um laço inflava a audiência de qualquer matéria, e a
   * ordenação "mais populares" usa esse número. Visita de artigo não publicado
   * (pré-visualização) não conta.
   */
  async registerView(articleId: string, viewer: ViewerIdentity) {
    const article = await this.requireArticle(articleId);

    if (!isPublished(article)) {
      return { success: true, counted: false };
    }

    const cacheKey = this.onceKey('view', articleId, viewer);

    if (!cacheKey || (await this.cache.get(cacheKey))) {
      return { success: true, counted: false };
    }

    await this.cache.set(cacheKey, 1, VIEW_WINDOW_MS);
    await this.prisma.blogArticle.update({
      where: { id: articleId },
      data: { viewCount: { increment: 1 } },
    });

    return { success: true, counted: true };
  }

  /**
   * Registra uma leitura completa e atualiza a média de tempo.
   *
   * **A média do legado perdia leitura.** Ela lia `readCount` e `avgReadTime`,
   * calculava a média nova e gravava: duas leituras ao mesmo tempo liam o mesmo
   * estado, e uma sobrescrevia a outra. Aqui a gravação só acontece se
   * `readCount` ainda for o lido; se outra leitura passou no meio, recomeça.
   *
   * Uma leitura por leitor por dia, e só de artigo publicado.
   */
  async registerRead(
    articleId: string,
    viewer: ViewerIdentity,
    readSeconds: number,
  ) {
    const article = await this.requireArticle(articleId);

    if (!isPublished(article)) {
      return { success: true, counted: false };
    }

    const cacheKey = this.onceKey('read', articleId, viewer);

    if (!cacheKey || (await this.cache.get(cacheKey))) {
      return { success: true, counted: false };
    }

    await this.cache.set(cacheKey, 1, READ_WINDOW_MS);

    const sample = clampReadSeconds(readSeconds, article.estimatedReadTime);

    for (let attempt = 0; attempt < AVERAGE_ATTEMPTS; attempt += 1) {
      const current = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
        select: { readCount: true, avgReadTime: true },
      });

      if (!current) {
        break;
      }

      const { count } = await this.prisma.blogArticle.updateMany({
        where: { id: articleId, readCount: current.readCount },
        data: {
          readCount: { increment: 1 },
          avgReadTime: nextAverage(
            current.avgReadTime,
            current.readCount,
            sample,
          ),
        },
      });

      if (count > 0) {
        return {
          success: true,
          counted: true,
          readCount: current.readCount + 1,
        };
      }
    }

    this.logger.warn(
      `Leitura do artigo ${articleId} não contou: disputa com outras leituras em ${AVERAGE_ATTEMPTS} tentativas`,
    );

    return { success: true, counted: false };
  }

  // -------------------------------------------------------------------

  private onceKey(
    kind: 'view' | 'read',
    articleId: string,
    viewer: ViewerIdentity,
  ): string | null {
    const key = viewerKey(viewer);

    // Prefixo fora dos namespaces do blog: a invalidação do cache de artigos
    // (`blog:articles*`) não pode zerar as janelas de contagem.
    return key ? `blog-${kind}:${articleId}:${key}` : null;
  }

  private async requireArticle(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      select: { status: true, publishedAt: true, estimatedReadTime: true },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }

  private async requirePublished(id: string) {
    const article = await this.requireArticle(id);

    if (!isPublished(article)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }
}

function isPublished(article: {
  status: ArticleStatus;
  publishedAt: Date | null;
}): boolean {
  return (
    article.status === ArticleStatus.PUBLISHED &&
    !!article.publishedAt &&
    article.publishedAt.getTime() <= Date.now()
  );
}

function publishedArticleFilter(
  category?: string,
): Prisma.BlogArticleWhereInput {
  return {
    status: ArticleStatus.PUBLISHED,
    publishedAt: { lte: new Date() },
    ...(category && category !== 'all'
      ? { categories: { some: { category: { slug: category } } } }
      : {}),
  };
}

function card(article: ArticleCard) {
  const { _count, categories, tags, ...rest } = article;

  return {
    ...rest,
    categories: categories.map((relation) => relation.category),
    tags: tags.map((relation) => relation.tag),
    stats: { comments: _count.comments, likes: _count.likes },
  };
}

function paginationOf(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
