import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, ArticleType, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTHOR_SELECT } from '../dto/author-ref.dto';
import { BlogMediaService } from '../media/blog-media.service';
import { featuredFields } from './article-featured';
import {
  ArticleStatusError,
  statusFields,
  StatusFields,
} from './article-status';
import { blogSlug, copySlug, estimateReadTime } from './article-text';
import {
  ArticleContentError,
  checkUrl,
  emptyDoc,
  sanitizeArticleContent,
} from './content/article-content.policy';
import { collectMediaUrls } from './content/media-urls';
import { urlField } from '../shared/url-field';
import {
  BackgroundMusicDto,
  CreateArticleDto,
  UpdateArticleDto,
} from './dto/write-article.dto';

type Tx = Prisma.TransactionClient;
type Data = Record<string, unknown>;

const WRITE_INCLUDE = { author: { select: AUTHOR_SELECT } } as const;

interface ExistingArticle extends StatusFields {
  id: string;
  slug: string;
  title: string;
  version: number;
  isFeatured: boolean;
  featuredOrder: number | null;
  tagIds: string[];
}

interface PreparedChange {
  data: Data;
  tags?: NormalizedTag[];
  categoryIds?: string[];
  featured?: { want?: boolean; order?: number };
}

interface NormalizedTag {
  name: string;
  slug: string;
}

const ARTICLE_TYPES = new Set<string>(Object.values(ArticleType));

/**
 * Escrita de artigos do blog.
 *
 * **Toda escrita é uma transação só.** O legado criava o artigo, depois as
 * categorias, depois cada tag, depois a versão — cada passo uma ida ao banco,
 * sem transação. Uma falha no meio (uma tag repetida na lista bastava: a
 * segunda criação da relação batia no índice único) deixava o artigo gravado
 * sem versão, e os contadores das tags já incrementados para relações que não
 * existiam.
 *
 * **O contador de artigos da tag é recontado, não somado.** O legado fazia
 * `increment` e `decrement` a cada escrita — o tipo de contador que diverge na
 * primeira falha e nunca mais volta. Aqui ele é recalculado a partir das
 * relações, para as tags que a escrita tocou.
 */
@Injectable()
export class ArticleWriterService {
  private readonly logger = new Logger(ArticleWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
    private readonly media: BlogMediaService,
  ) {}

  async create(dto: CreateArticleDto, userId: string) {
    if (!dto.title.trim()) {
      throw new BadRequestException('Título é obrigatório');
    }

    const data = this.scalarData(dto);

    if (dto.content === undefined) {
      data.content = emptyDoc();
      data.estimatedReadTime = null;
    }

    const state = statusOf(
      null,
      dto.status ?? ArticleStatus.DRAFT,
      dateOf(dto.scheduledFor),
      new Date(),
    );
    const tags = normalizeTags(dto.tags ?? []);
    const categoryIds = unique(dto.categoryIds ?? []);
    const slug = dto.slug.trim();

    const article = await this.prisma.$transaction(async (tx: Tx) => {
      await this.assertSlugFree(tx, slug);
      await this.assertCategories(tx, categoryIds);

      const featured = await featuredFields(
        tx,
        dto.isFeatured,
        dto.featuredOrder,
        null,
      );

      const created = await tx.blogArticle.create({
        data: {
          ...data,
          ...state,
          ...featured,
          slug,
          authorId: userId,
          version: 1,
        } as Prisma.BlogArticleUncheckedCreateInput,
        include: WRITE_INCLUDE,
      });

      await this.syncCategories(tx, created.id, categoryIds);
      await this.syncTags(tx, created.id, tags, []);
      await this.recordVersion(tx, created.id, 1, userId, 'Versão inicial');

      return created;
    });

    await this.invalidate();
    await this.adoptFiles(article);

    return { success: true, article, message: 'Artigo criado com sucesso' };
  }

  async update(id: string, dto: UpdateArticleDto, userId: string) {
    const existing = await this.requireArticle(id);

    if (
      dto.expectedVersion !== undefined &&
      dto.expectedVersion !== existing.version
    ) {
      throw new ConflictException(
        `O artigo está na versão ${existing.version}, e esta edição partiu da ` +
          `${dto.expectedVersion}. Recarregue para não apagar o que foi gravado depois.`,
      );
    }

    if (dto.title !== undefined && !dto.title.trim()) {
      throw new BadRequestException('Título é obrigatório');
    }

    const data = {
      ...this.scalarData(dto),
      ...this.stateChange(existing, dto, new Date()),
    };

    const article = await this.commit(
      existing,
      {
        data,
        tags: dto.tags ? normalizeTags(dto.tags) : undefined,
        categoryIds: dto.categoryIds ? unique(dto.categoryIds) : undefined,
        featured: { want: dto.isFeatured, order: dto.featuredOrder },
      },
      userId,
      dto.changeLog?.trim() || 'Atualização do artigo',
    );

    return {
      success: true,
      article,
      message: 'Artigo atualizado com sucesso',
    };
  }

  async remove(id: string) {
    const existing = await this.requireArticle(id);

    await this.prisma.$transaction(async (tx: Tx) => {
      // Comentários, curtidas, salvos, mídia, versões e relações saem junto —
      // `onDelete: Cascade` no schema, que o Prisma aplica no MongoDB.
      await tx.blogArticle.delete({ where: { id } });
      await this.recountTags(tx, existing.tagIds);
    });

    await this.invalidate();

    return { success: true, message: 'Artigo deletado com sucesso' };
  }

  /**
   * Duplica um artigo como rascunho.
   *
   * **O conteúdo passa pela política de novo.** Sem isso, duplicar seria o
   * caminho para copiar conteúdo gravado pelo legado — que nunca foi validado —
   * para um artigo novo, sem que ele passasse por checagem nenhuma.
   */
  async duplicate(id: string, userId: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const original = await this.prisma.blogArticle.findUnique({
      where: { id },
      include: {
        categories: { select: { categoryId: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    });

    if (!original) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const { doc, words } = contentOf(
      original.content,
      'O artigo original tem conteúdo que a política recusa — corrija-o antes de duplicar. ',
    );

    const taken = await this.prisma.blogArticle.findMany({
      where: { slug: { startsWith: `${original.slug}-copia` } },
      select: { slug: true },
    });
    const slug = copySlug(
      original.slug,
      new Set(taken.map((article) => article.slug)),
    );

    const duplicated = await this.prisma.$transaction(async (tx: Tx) => {
      const created = await tx.blogArticle.create({
        data: {
          title: `${original.title} (Cópia)`,
          slug,
          description: original.description,
          content: doc as unknown as Prisma.InputJsonValue,
          estimatedReadTime: estimateReadTime(words),
          coverImage: original.coverImage,
          coverImageAlt: original.coverImageAlt,
          coverImageCredit: original.coverImageCredit,
          // Sempre rascunho, e fora do destaque: a cópia é ponto de partida,
          // não uma segunda matéria no ar.
          status: ArticleStatus.DRAFT,
          isFeatured: false,
          types: original.types,
          authorId: userId,
          composerIds: original.composerIds,
          workIds: original.workIds,
          scoreIds: original.scoreIds,
          instrumentIds: original.instrumentIds,
          epochIds: original.epochIds,
          backgroundMusicUrl: original.backgroundMusicUrl,
          backgroundMusicTitle: original.backgroundMusicTitle,
          backgroundMusicVolume: original.backgroundMusicVolume,
          backgroundMusicLoop: original.backgroundMusicLoop,
          backgroundMusicAutoplay: original.backgroundMusicAutoplay,
          metaTitle: original.metaTitle,
          metaDescription: original.metaDescription,
          keywords: original.keywords,
          readTime: original.readTime,
          version: 1,
        },
        include: WRITE_INCLUDE,
      });

      await this.syncCategories(
        tx,
        created.id,
        original.categories.map((relation) => relation.categoryId),
      );
      await this.syncTags(
        tx,
        created.id,
        normalizeTags(original.tags.map((relation) => relation.tag.name)),
        [],
      );
      await this.recordVersion(
        tx,
        created.id,
        1,
        userId,
        `Duplicado de: ${original.title}`,
      );

      return created;
    });

    await this.invalidate();
    await this.adoptFiles(duplicated);

    return {
      success: true,
      article: duplicated,
      message: 'Artigo duplicado com sucesso',
    };
  }

  // -------------------------------------------------------------------
  // Versões
  // -------------------------------------------------------------------

  /**
   * Histórico de versões.
   *
   * **O legado gravava versões e não tinha rota nenhuma para lê-las.** Seis
   * versões na base, 60 KB cada, que ninguém conseguia abrir.
   */
  async listVersions(id: string) {
    await this.requireArticle(id);

    const versions = await this.prisma.blogArticleVersion.findMany({
      where: { articleId: id },
      select: {
        id: true,
        version: true,
        editedBy: true,
        changeLog: true,
        createdAt: true,
      },
      orderBy: { version: 'desc' },
    });

    const editors = await this.prisma.user.findMany({
      where: { id: { in: unique(versions.map((entry) => entry.editedBy)) } },
      select: AUTHOR_SELECT,
    });
    const byId = new Map(editors.map((editor) => [editor.id, editor]));

    return {
      success: true,
      versions: versions.map((entry) => ({
        ...entry,
        editor: byId.get(entry.editedBy) ?? null,
      })),
    };
  }

  async getVersion(id: string, version: number) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Versão não encontrada');
    }

    const entry = await this.prisma.blogArticleVersion.findFirst({
      where: { articleId: id, version },
    });

    if (!entry) {
      throw new NotFoundException('Versão não encontrada');
    }

    return { success: true, version: entry };
  }

  /**
   * Restaura o texto de uma versão, gravando uma versão nova.
   *
   * Restaura o **conteúdo** — título, texto, capa, vínculos, SEO, música de
   * fundo, e categorias e tags quando a versão as guardou. **Não** restaura
   * estado, slug nem destaque: voltar o texto de uma matéria não pode tirá-la
   * do ar, mudar o endereço dela nem mexer no carrossel.
   *
   * As versões gravadas pelo legado não guardavam categorias nem tags — o
   * snapshot era o artigo com o autor embutido. Nelas, as categorias e tags
   * atuais ficam como estão.
   */
  async restore(id: string, version: number, userId: string) {
    const existing = await this.requireArticle(id);
    const { version: entry } = await this.getVersion(id, version);
    const snapshot = asRecord(entry.snapshot);

    const data = restorableData(snapshot, version);

    let categoryIds: string[] | undefined;

    if (Array.isArray(snapshot.categoryIds)) {
      // Categoria apagada depois da versão não pode impedir a restauração: fica
      // de fora, e o resto volta.
      const wanted = unique(
        snapshot.categoryIds.filter(
          (value): value is string =>
            typeof value === 'string' && isMongoId(value),
        ),
      );
      const found = await this.prisma.blogCategory.findMany({
        where: { id: { in: wanted } },
        select: { id: true },
      });
      categoryIds = found.map((category) => category.id);
    }

    const tags = Array.isArray(snapshot.tagNames)
      ? normalizeTags(
          snapshot.tagNames.filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(blogSlug(value)),
          ),
        )
      : undefined;

    const article = await this.commit(
      existing,
      { data, tags, categoryIds },
      userId,
      `Restaurado da versão ${version}`,
    );

    return {
      success: true,
      article,
      message: `Versão ${version} restaurada como versão ${existing.version + 1}`,
    };
  }

  // -------------------------------------------------------------------

  /**
   * Grava uma mudança com trava otimista.
   *
   * O `updateMany` só acha o artigo se ele ainda estiver na versão lida. Se
   * outra gravação passou no meio, nada é escrito e a resposta é 409 — no
   * legado, a última gravação vencia e a anterior sumia sem aviso, com duas
   * versões de mesmo número no histórico.
   */
  private async commit(
    existing: ExistingArticle,
    change: PreparedChange,
    userId: string,
    changeLog: string,
  ) {
    const slug = change.data.slug as string | undefined;
    const nextVersion = existing.version + 1;

    const article = await this.prisma.$transaction(async (tx: Tx) => {
      if (slug && slug !== existing.slug) {
        await this.assertSlugFree(tx, slug);
      }

      if (change.categoryIds) {
        await this.assertCategories(tx, change.categoryIds);
      }

      const featured = await featuredFields(
        tx,
        change.featured?.want,
        change.featured?.order,
        existing,
      );

      const { count } = await tx.blogArticle.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          ...change.data,
          ...featured,
          version: nextVersion,
        } as Prisma.BlogArticleUpdateManyMutationInput,
      });

      if (count === 0) {
        throw new ConflictException(
          'O artigo foi alterado por outra pessoa enquanto esta edição era gravada. Recarregue e tente de novo.',
        );
      }

      await this.syncCategories(tx, existing.id, change.categoryIds);
      await this.syncTags(tx, existing.id, change.tags, existing.tagIds);
      await this.recordVersion(tx, existing.id, nextVersion, userId, changeLog);

      return tx.blogArticle.findUniqueOrThrow({
        where: { id: existing.id },
        include: WRITE_INCLUDE,
      });
    });

    await this.invalidate();
    await this.adoptFiles(article);

    return article;
  }

  /**
   * O artigo adota os arquivos enviados pelo formulário antes de ele existir.
   *
   * Sem isso, a imagem enviada na criação ficaria registrada para sempre como
   * de uma sessão de formulário, fora da varredura de órfãos. **Falha aqui não
   * desfaz a gravação**: o arquivo continua no ar e o artigo continua salvo — só
   * fica marcado como temporário na galeria.
   */
  private async adoptFiles(article: {
    id: string;
    content: unknown;
    coverImage: string | null;
    backgroundMusicUrl: string | null;
  }): Promise<void> {
    try {
      await this.media.adoptDrafts(article.id, [
        ...collectMediaUrls(article.content),
        article.coverImage ?? '',
        article.backgroundMusicUrl ?? '',
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `Arquivos de rascunho não foram adotados pelo artigo ${article.id}: ${errorMessage(error)}`,
      );
    }
  }

  private stateChange(
    existing: ExistingArticle,
    dto: UpdateArticleDto,
    now: Date,
  ): Partial<StatusFields> {
    const scheduledFor = dateOf(dto.scheduledFor);

    if (dto.status !== undefined) {
      return statusOf(
        existing,
        dto.status,
        // O formulário reenvia o estado inteiro: um artigo agendado que volta
        // sem data mantém a que já tinha.
        scheduledFor ??
          (dto.status === ArticleStatus.SCHEDULED
            ? existing.scheduledFor
            : null),
        now,
      );
    }

    if (scheduledFor) {
      if (existing.status !== ArticleStatus.SCHEDULED) {
        throw new BadRequestException(
          'Para agendar, envie também `status: SCHEDULED`.',
        );
      }

      return statusOf(existing, ArticleStatus.SCHEDULED, scheduledFor, now);
    }

    return {};
  }

  /** Campos simples do artigo, só os que vieram na requisição. */
  private scalarData(dto: UpdateArticleDto): Data {
    const data: Data = {};

    const set = (key: string, value: unknown) => {
      if (value !== undefined) {
        data[key] = value;
      }
    };

    set('title', dto.title?.trim());
    set('slug', dto.slug?.trim());
    set('description', trimmed(dto.description));
    set('coverImage', urlField(dto.coverImage, 'media', 'coverImage'));
    set('coverImageAlt', trimmed(dto.coverImageAlt));
    set('coverImageCredit', trimmed(dto.coverImageCredit));
    set('readTime', dto.readTime);
    set('types', dto.types ? unique(dto.types) : undefined);
    set('composerIds', dto.composerIds ? unique(dto.composerIds) : undefined);
    set('workIds', dto.workIds ? unique(dto.workIds) : undefined);
    set('scoreIds', dto.scoreIds ? unique(dto.scoreIds) : undefined);
    set(
      'instrumentIds',
      dto.instrumentIds ? unique(dto.instrumentIds) : undefined,
    );
    set('epochIds', dto.epochIds ? unique(dto.epochIds) : undefined);
    set('coAuthorIds', dto.coAuthorIds ? unique(dto.coAuthorIds) : undefined);
    set('metaTitle', trimmed(dto.metaTitle));
    set('metaDescription', trimmed(dto.metaDescription));
    set(
      'keywords',
      dto.keywords?.map((keyword) => keyword.trim()).filter(Boolean),
    );

    if (dto.backgroundMusic !== undefined) {
      Object.assign(data, backgroundMusicData(dto.backgroundMusic));
    }

    if (dto.content !== undefined) {
      const { doc, words } = contentOf(dto.content);
      data.content = doc;
      data.estimatedReadTime = estimateReadTime(words);
    }

    return data;
  }

  private async requireArticle(id: string): Promise<ExistingArticle> {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        title: true,
        version: true,
        status: true,
        publishedAt: true,
        scheduledFor: true,
        isFeatured: true,
        featuredOrder: true,
        tags: { select: { tagId: true } },
      },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const { tags, ...rest } = article;
    return { ...rest, tagIds: tags.map((relation) => relation.tagId) };
  }

  private async assertSlugFree(tx: Tx, slug: string): Promise<void> {
    const taken = await tx.blogArticle.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictException(`Slug já existe: "${slug}". Use outro.`);
    }
  }

  /**
   * Toda categoria pedida precisa existir.
   *
   * O legado gravava a relação com qualquer id. No MongoDB não há chave
   * estrangeira: a relação apontava para o nada, e a listagem de artigos, que
   * faz `categories.map((c) => c.category)`, devolvia `null` dentro da lista.
   */
  private async assertCategories(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const found = await tx.blogCategory.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const existing = new Set(found.map((category) => category.id));
    const missing = ids.filter((id) => !existing.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Categoria inexistente: ${missing.join(', ')}`,
      );
    }
  }

  private async syncCategories(
    tx: Tx,
    articleId: string,
    ids: string[] | undefined,
  ): Promise<void> {
    if (ids === undefined) {
      return;
    }

    await tx.blogArticleCategory.deleteMany({ where: { articleId } });

    if (ids.length > 0) {
      await tx.blogArticleCategory.createMany({
        data: ids.map((categoryId) => ({ articleId, categoryId })),
      });
    }
  }

  private async syncTags(
    tx: Tx,
    articleId: string,
    tags: NormalizedTag[] | undefined,
    previousTagIds: string[],
  ): Promise<void> {
    if (tags === undefined) {
      return;
    }

    await tx.blogArticleTag.deleteMany({ where: { articleId } });

    const tagIds: string[] = [];

    for (const tag of tags) {
      // Procura por slug **ou** por nome. O painel de tags permite criar e
      // renomear com um slug que não é o derivado do nome — e, como `name`
      // também é único, um `upsert` só por slug tentaria criar uma segunda tag
      // com o mesmo nome, e a gravação do artigo cairia com 409.
      const found = await tx.blogTag.findFirst({
        where: { OR: [{ slug: tag.slug }, { name: tag.name }] },
        select: { id: true },
      });
      const record =
        found ??
        (await tx.blogTag.create({
          data: { name: tag.name, slug: tag.slug, articleCount: 0 },
          select: { id: true },
        }));

      tagIds.push(record.id);
    }

    if (tagIds.length > 0) {
      await tx.blogArticleTag.createMany({
        data: tagIds.map((tagId) => ({ articleId, tagId })),
      });
    }

    await this.recountTags(tx, unique([...previousTagIds, ...tagIds]));
  }

  private async recountTags(tx: Tx, tagIds: string[]): Promise<void> {
    for (const tagId of tagIds) {
      const articleCount = await tx.blogArticleTag.count({ where: { tagId } });

      await tx.blogTag.update({
        where: { id: tagId },
        data: { articleCount },
      });
    }
  }

  /**
   * Grava a versão a partir do estado já persistido.
   *
   * Guarda as categorias (por id) e as tags (por nome) junto do artigo. O
   * legado guardava o artigo com o autor embutido e sem nenhuma das duas — uma
   * versão antiga não tinha como devolver as tags que o texto usava.
   */
  private async recordVersion(
    tx: Tx,
    articleId: string,
    version: number,
    userId: string,
    changeLog: string,
  ): Promise<void> {
    const article = await tx.blogArticle.findUniqueOrThrow({
      where: { id: articleId },
    });
    const categories = await tx.blogArticleCategory.findMany({
      where: { articleId },
      select: { categoryId: true },
    });
    const tags = await tx.blogArticleTag.findMany({
      where: { articleId },
      select: { tag: { select: { name: true } } },
    });

    await tx.blogArticleVersion.create({
      data: {
        articleId,
        version,
        snapshot: JSON.parse(
          JSON.stringify({
            ...article,
            categoryIds: categories.map((relation) => relation.categoryId),
            tagNames: tags.map((relation) => relation.tag.name),
          }),
        ) as Prisma.InputJsonValue,
        editedBy: userId,
        changeLog,
      },
    });
  }

  private async invalidate(): Promise<void> {
    await this.cache.invalidateMany([
      CacheNamespace.BLOG_ARTICLES,
      CacheNamespace.BLOG_TAGS,
      CacheNamespace.BLOG_CATEGORIES,
    ]);
  }
}

// ---------------------------------------------------------------------------

function contentOf(raw: unknown, prefix = '') {
  try {
    return sanitizeArticleContent(raw);
  } catch (error: unknown) {
    if (error instanceof ArticleContentError) {
      throw new BadRequestException(
        `${prefix}Conteúdo recusado em ${error.path}: ${error.reason}`,
      );
    }

    throw error;
  }
}

function statusOf(
  current: StatusFields | null,
  target: ArticleStatus,
  scheduledFor: Date | null | undefined,
  now: Date,
): StatusFields {
  try {
    return statusFields(current, target, scheduledFor, now);
  } catch (error: unknown) {
    if (error instanceof ArticleStatusError) {
      throw new BadRequestException(error.message);
    }

    throw error;
  }
}

function backgroundMusicData(music: BackgroundMusicDto | null): Data {
  if (music === null) {
    return { backgroundMusicUrl: null, backgroundMusicTitle: null };
  }

  return {
    backgroundMusicUrl:
      urlField(music.url, 'media-or-youtube', 'backgroundMusic.url') ?? null,
    backgroundMusicTitle: music.title?.trim() || null,
    // O legado fazia `volume || 0.3`: volume zero virava 0,3, e não havia como
    // deixar a música de fundo muda.
    backgroundMusicVolume: music.volume ?? 0.3,
    backgroundMusicLoop: music.loop !== false,
    backgroundMusicAutoplay: music.autoplay !== false,
  };
}

/**
 * Tags a gravar, uma por slug.
 *
 * "Chopin" e "chopin" dão o mesmo slug e são a mesma tag. No legado, repetir a
 * tag na lista quebrava a gravação no meio: a segunda relação batia no índice
 * único, com o artigo já criado.
 */
export function normalizeTags(names: string[]): NormalizedTag[] {
  const bySlug = new Map<string, NormalizedTag>();

  for (const raw of names) {
    const name = raw.trim();
    const slug = blogSlug(name);

    if (!slug) {
      throw new BadRequestException(
        `Tag sem letra nem número, que não gera endereço: "${raw}"`,
      );
    }

    if (!bySlug.has(slug)) {
      bySlug.set(slug, { name, slug });
    }
  }

  return [...bySlug.values()];
}

/** Os campos que uma versão devolve ao artigo. */
function restorableData(snapshot: Data, version: number): Data {
  const data: Data = {};

  const str = (key: string) => {
    const value = snapshot[key];
    if (typeof value === 'string' || value === null) data[key] = value;
  };

  if (typeof snapshot.title === 'string' && snapshot.title.trim()) {
    data.title = snapshot.title.trim();
  }

  for (const key of [
    'description',
    'coverImageAlt',
    'coverImageCredit',
    'metaTitle',
    'metaDescription',
    'backgroundMusicTitle',
  ]) {
    str(key);
  }

  const fail = (reason: string) =>
    new BadRequestException(
      `A versão ${version} tem conteúdo que a política atual recusa — ${reason}`,
    );

  for (const [key, kind] of [
    ['coverImage', 'media'],
    ['backgroundMusicUrl', 'media-or-youtube'],
  ] as const) {
    const value = snapshot[key];

    if (typeof value === 'string') {
      try {
        data[key] = checkUrl(value, kind, key) || null;
      } catch (error: unknown) {
        if (error instanceof ArticleContentError) throw fail(error.message);
        throw error;
      }
    } else if (value === null) {
      data[key] = null;
    }
  }

  for (const key of [
    'composerIds',
    'workIds',
    'instrumentIds',
    'epochIds',
    'coAuthorIds',
  ]) {
    const value = snapshot[key];

    if (Array.isArray(value)) {
      data[key] = unique(
        value.filter(
          (entry): entry is string =>
            typeof entry === 'string' && isMongoId(entry),
        ),
      );
    }
  }

  for (const key of ['scoreIds', 'keywords']) {
    const value = snapshot[key];

    if (Array.isArray(value)) {
      data[key] = value.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }
  }

  if (Array.isArray(snapshot.types)) {
    data.types = snapshot.types.filter(
      (entry): entry is string =>
        typeof entry === 'string' && ARTICLE_TYPES.has(entry),
    );
  }

  if (typeof snapshot.readTime === 'number') data.readTime = snapshot.readTime;

  if (typeof snapshot.backgroundMusicVolume === 'number') {
    data.backgroundMusicVolume = snapshot.backgroundMusicVolume;
  }

  for (const key of ['backgroundMusicLoop', 'backgroundMusicAutoplay']) {
    if (typeof snapshot[key] === 'boolean') data[key] = snapshot[key];
  }

  if (snapshot.content !== undefined) {
    try {
      const { doc, words } = sanitizeArticleContent(snapshot.content);
      data.content = doc;
      data.estimatedReadTime = estimateReadTime(words);
    } catch (error: unknown) {
      if (error instanceof ArticleContentError) throw fail(error.message);
      throw error;
    }
  }

  return data;
}

function asRecord(value: unknown): Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Data)
    : {};
}

function trimmed(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

function dateOf(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
