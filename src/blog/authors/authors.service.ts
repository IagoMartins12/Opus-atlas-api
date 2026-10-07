import { Injectable, NotFoundException } from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTHOR_SELECT_WITH_BIO } from '../dto/author-ref.dto';
import { cachedRead, cacheKey } from '../shared/cached-read';

/** Id do Mongo; o que não for id é tratado como nome de usuário. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Teto da leitura que conta as categorias: um autor real nunca chega perto. */
const MAX_ARTICLES = 2_000;

/**
 * A página pública de quem escreve no blog.
 *
 * **Só quem tem artigo publicado tem página.** O endereço aceita nome de
 * usuário ou id, e qualquer conta da plataforma tem os dois: sem essa regra,
 * a rota viraria um catálogo de contas — inclusive de quem marcou o perfil
 * como privado. Quem publicou já tem nome, foto e bio à mostra em cada
 * artigo; a página só junta o que já é público.
 *
 * No cache do namespace dos artigos: publicar, despublicar ou apagar um
 * artigo derruba a página junto.
 */
@Injectable()
export class AuthorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  findOne(usernameOrId: string) {
    return cachedRead(
      this.cache,
      cacheKey(CacheNamespace.BLOG_ARTICLES, 'author', { usernameOrId }),
      CacheTtl.MUTABLE,
      'blog/authors/detail',
      () => this.load(usernameOrId),
    );
  }

  private async load(usernameOrId: string) {
    const author = await this.prisma.user.findFirst({
      where: OBJECT_ID.test(usernameOrId)
        ? { OR: [{ id: usernameOrId }, { username: usernameOrId }] }
        : { username: usernameOrId },
      select: AUTHOR_SELECT_WITH_BIO,
    });

    if (!author) {
      throw new NotFoundException('Autor não encontrado');
    }

    const published: Prisma.BlogArticleWhereInput = {
      authorId: author.id,
      status: ArticleStatus.PUBLISHED,
      publishedAt: { lte: new Date() },
    };

    const [summary, articles] = await Promise.all([
      this.prisma.blogArticle.aggregate({
        where: published,
        _count: { _all: true },
        _sum: { viewCount: true },
        _min: { publishedAt: true },
        _max: { publishedAt: true },
      }),
      this.prisma.blogArticle.findMany({
        where: published,
        select: {
          categories: {
            select: {
              category: {
                select: { id: true, name: true, slug: true, isActive: true },
              },
            },
          },
        },
        take: MAX_ARTICLES,
      }),
    ]);

    if (summary._count._all === 0) {
      throw new NotFoundException('Autor não encontrado');
    }

    // O `groupBy` do Prisma não agrupa por relação: as categorias são
    // contadas aqui, a partir dos artigos (poucos por autor).
    const porCategoria = new Map<
      string,
      { id: string; name: string; slug: string; articles: number }
    >();

    for (const article of articles) {
      for (const { category } of article.categories) {
        if (!category.isActive) continue;
        const atual = porCategoria.get(category.id);
        if (atual) atual.articles += 1;
        else
          porCategoria.set(category.id, {
            id: category.id,
            name: category.name,
            slug: category.slug,
            articles: 1,
          });
      }
    }

    return {
      success: true,
      author,
      stats: {
        articles: summary._count._all,
        views: summary._sum.viewCount ?? 0,
        firstPublishedAt: summary._min.publishedAt,
        lastPublishedAt: summary._max.publishedAt,
      },
      categories: [...porCategoria.values()].sort(
        (a, b) => b.articles - a.articles || a.name.localeCompare(b.name),
      ),
    };
  }
}
