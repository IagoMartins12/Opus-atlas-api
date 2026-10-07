import { Injectable } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { AppCacheService } from '../common/cache/cache.service';
import { CacheNamespace } from '../common/cache/cache-keys';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_TEACHER_WHERE } from '../public-teachers/public-teachers.service';

/** Sitemap tolera atraso: o buscador lê uma vez por dia, no máximo. */
const SITEMAP_TTL_MS = 60 * 60 * 1000;

/** Os mesmos tetos do legado — o sitemap lista o relevante, não o catálogo inteiro. */
const MAX_COMPOSERS = 500;
const MAX_WORKS = 2_000;
const MAX_ARTICLES = 5_000;
const MAX_TEACHERS = 2_000;

export interface SitemapEntries {
  generatedAt: string;
  composers: Array<{ id: string; name: string; lastModified: Date }>;
  works: Array<{ id: string; title: string; lastModified: Date }>;
  articles: Array<{ slug: string; lastModified: Date }>;
  /** Categorias ativas com artigo publicado. */
  blogCategories: Array<{ slug: string; lastModified: Date }>;
  /** Tags com artigo publicado. */
  blogTags: Array<{ slug: string; lastModified: Date }>;
  /** Quem tem artigo publicado: o nome de usuário, ou o id quando não há. */
  blogAuthors: Array<{ id: string; lastModified: Date }>;
  teachers: Array<{ id: string; lastModified: Date }>;
}

/**
 * Dados do sitemap — o substituto das duas cópias de consultas Prisma do front
 * (`sitemap-data.ts` e `sitemap-fetcher.ts`, que divergiam).
 *
 * **O XML continua sendo do Next.** O sitemap precisa morar no domínio do site,
 * e o formato das URLs (`/works/:id`, `/blog/:slug`) é assunto do front. Aqui
 * sai só o dado: quem entra e quando mudou. Uma API que gerasse o XML teria de
 * conhecer as rotas do front.
 *
 * **Entram também as matérias do blog e os professores públicos**, que o
 * sitemap do legado não listava — o blog é o conteúdo mais indexável do
 * produto.
 */
@Injectable()
export class SeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async sitemapEntries(): Promise<SitemapEntries> {
    // No namespace de descobertas: escrita no catálogo limpa junto.
    const key = `${CacheNamespace.DISCOVERY}:sitemap:v1`;
    const cached = await this.cache.get<SitemapEntries>(key, 'seo/sitemap');

    if (cached) {
      return cached;
    }

    const entries = await this.load();
    await this.cache.set(key, entries, SITEMAP_TTL_MS);
    return entries;
  }

  private async load(): Promise<SitemapEntries> {
    const [composers, works, articles, teachers] = await Promise.all([
      this.relevantComposers(),
      this.relevantWorks(),
      this.prisma.blogArticle.findMany({
        where: {
          status: ArticleStatus.PUBLISHED,
          publishedAt: { lte: new Date() },
        },
        select: {
          slug: true,
          updatedAt: true,
          authorId: true,
          categories: {
            select: { category: { select: { slug: true, isActive: true } } },
          },
          tags: { select: { tag: { select: { slug: true } } } },
        },
        orderBy: { publishedAt: 'desc' },
        take: MAX_ARTICLES,
      }),
      this.prisma.teacher.findMany({
        where: PUBLIC_TEACHER_WHERE,
        select: { userId: true, updatedAt: true },
        take: MAX_TEACHERS,
      }),
    ]);

    const blog = await this.blogPages(articles);

    return {
      generatedAt: new Date().toISOString(),
      composers: composers.map((composer) => ({
        id: composer.id,
        name: composer.fullName || composer.name,
        lastModified: composer.updatedAt,
      })),
      works: works.map((work) => ({
        id: work.id,
        title: work.title,
        lastModified: work.updatedAt,
      })),
      articles: articles.map((article) => ({
        slug: article.slug,
        lastModified: article.updatedAt,
      })),
      ...blog,
      // O id público do professor é o do usuário (é o slug de `/teachers/:id`).
      teachers: teachers.map((teacher) => ({
        id: teacher.userId,
        lastModified: teacher.updatedAt,
      })),
    };
  }

  /**
   * As páginas do blog que existem por causa dos artigos: cada categoria,
   * cada tag e cada autor com artigo publicado. Saem dos próprios artigos já
   * lidos, com a data do artigo mais recente de cada uma — uma página de
   * categoria muda quando entra artigo nela.
   */
  private async blogPages(
    articles: Array<{
      updatedAt: Date;
      authorId: string;
      categories: Array<{ category: { slug: string; isActive: boolean } }>;
      tags: Array<{ tag: { slug: string } }>;
    }>,
  ) {
    const recente = (mapa: Map<string, Date>, chave: string, data: Date) => {
      const atual = mapa.get(chave);
      if (!atual || atual < data) mapa.set(chave, data);
    };

    const categorias = new Map<string, Date>();
    const tags = new Map<string, Date>();
    const autores = new Map<string, Date>();

    for (const article of articles) {
      for (const { category } of article.categories) {
        if (category.isActive)
          recente(categorias, category.slug, article.updatedAt);
      }
      for (const { tag } of article.tags) {
        recente(tags, tag.slug, article.updatedAt);
      }
      recente(autores, article.authorId, article.updatedAt);
    }

    const usuarios = autores.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...autores.keys()] } },
          select: { id: true, username: true },
        })
      : [];
    const endereco = new Map(usuarios.map((u) => [u.id, u.username || u.id]));

    const lista = (mapa: Map<string, Date>) =>
      [...mapa].map(([slug, lastModified]) => ({ slug, lastModified }));

    return {
      blogCategories: lista(categorias),
      blogTags: lista(tags),
      blogAuthors: [...autores].map(([id, lastModified]) => ({
        id: endereco.get(id) ?? id,
        lastModified,
      })),
    };
  }

  /**
   * Compositores relevantes: verificados, depois com imagem, depois de
   * qualidade alta — o critério do legado, **sem** ordenar pela contagem de
   * obras. Essa ordenação cruzava as 207 mil obras a cada consulta e estourava
   * o tempo da requisição (408) com a base real.
   */
  private async relevantComposers() {
    const select = { id: true, fullName: true, name: true, updatedAt: true };
    const picked = new Map<
      string,
      { id: string; fullName: string; name: string; updatedAt: Date }
    >();

    for (const where of [
      { isVerified: true },
      { hasValidImage: true },
      { dataQuality: 'high' },
    ]) {
      if (picked.size >= MAX_COMPOSERS) break;

      const rows = await this.prisma.composer.findMany({
        where,
        select,
        orderBy: { updatedAt: 'desc' },
        take: MAX_COMPOSERS - picked.size,
      });
      rows.forEach((row) => picked.set(row.id, row));
    }

    return [...picked.values()];
  }

  /**
   * Obras relevantes: as mais favoritadas e as mais anotadas, contadas nas
   * próprias coleções (agrupamento pequeno), completadas pelas mais recentes
   * de compositores verificados ou com imagem. O legado ordenava as 207 mil obras pela
   * contagem das relações.
   */
  private async relevantWorks() {
    const [favorited, annotated] = await Promise.all([
      this.prisma.favoriteWork.groupBy({
        by: ['workId'],
        _count: { workId: true },
        orderBy: { _count: { workId: 'desc' } },
        take: MAX_WORKS,
      }),
      this.prisma.annotation.groupBy({
        by: ['workId'],
        _count: { workId: true },
        orderBy: { _count: { workId: 'desc' } },
        take: MAX_WORKS,
      }),
    ]);

    const ids = [
      ...new Set([
        ...favorited.map((row) => row.workId),
        ...annotated.map((row) => row.workId),
      ]),
    ].slice(0, MAX_WORKS);

    const popular = ids.length
      ? await this.prisma.work.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, updatedAt: true },
        })
      : [];

    const remaining = MAX_WORKS - popular.length;
    // Os ids primeiro: filtrar obra pela relação com o compositor cruzaria as
    // coleções inteiras.
    // Verificados primeiro, depois com imagem — os dois critérios do legado.
    const verified =
      remaining > 0
        ? await this.prisma.composer.findMany({
            where: { OR: [{ isVerified: true }, { hasValidImage: true }] },
            select: { id: true },
            orderBy: [{ isVerified: 'desc' }, { updatedAt: 'desc' }],
            take: 500,
          })
        : [];
    const recent =
      remaining > 0 && verified.length > 0
        ? await this.prisma.work.findMany({
            where: {
              id: { notIn: ids },
              composerId: { in: verified.map((composer) => composer.id) },
            },
            select: { id: true, title: true, updatedAt: true },
            // Sem ordenação: num sitemap a ordem não importa, e ordenar o
            // conjunto por data estourava o tempo (408) sem índice que cobrisse.
            take: remaining,
          })
        : [];

    return [...popular, ...recent];
  }
}
