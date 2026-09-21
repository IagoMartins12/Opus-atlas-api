import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ArticleStatus,
  MediaType,
  StorageAssetKind,
  StorageAssetStatus,
} from '@prisma/client';
import { isMongoId } from 'class-validator';
import { randomUUID } from 'crypto';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import {
  StorageService,
  UploadedFile,
} from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredUrl, urlField } from '../shared/url-field';
import {
  CreateMediaDto,
  DeleteGalleryDto,
  GalleryCategory,
  GalleryQueryDto,
  ListArticleMediaQueryDto,
  MediaFolder,
  UpdateMediaDto,
} from './dto/media.dto';
import { buildUsage, formatBytes, MediaUsage } from './media-usage';

/** Dono do arquivo de um artigo em `StoredAsset` — o nome que a varredura de órfãos conhece. */
export const ARTICLE_ASSET_ENTITY = 'blogArticle';

/**
 * Dono provisório: arquivo enviado pelo formulário de criação, antes de o
 * artigo existir. O `entityId` é a sessão do formulário.
 */
export const DRAFT_ASSET_ENTITY = 'blogDraft';

export const BLOG_ASSET_KINDS: StorageAssetKind[] = [
  StorageAssetKind.BLOG_MEDIA,
  StorageAssetKind.BLOG_AUDIO,
];

const ROLE_ADMIN = 1;

const MEDIA_FIELDS = [
  'title',
  'caption',
  'credit',
  'alt',
  'duration',
  'width',
  'height',
  'fileSize',
  'order',
  'isInline',
  'inGallery',
] as const;

/**
 * Mídia do blog: upload, galeria do artigo e a galeria do painel.
 *
 * **O arquivo sai do disco do Next.** O legado gravava em `public/uploads/blog`
 * — que não sobrevive a um contêiner efêmero nem é compartilhado entre
 * réplicas — e montava o caminho com o que vinha do formulário. Aqui ele vai
 * para o armazenamento em nuvem, com o tipo conferido pelos bytes, e fica
 * registrado em `StoredAsset` com o dono. Nada é apagado por caminho: só por
 * registro.
 */
@Injectable()
export class BlogMediaService {
  private readonly logger = new Logger(BlogMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Recebe um arquivo do editor.
   *
   * Com artigo, o arquivo nasce dele. Sem artigo — o formulário de criação —,
   * nasce da sessão do formulário, e o artigo o adota quando é salvo.
   *
   * **No legado, a adoção nunca acontecia.** A rota que "movia os temporários
   * para a pasta do artigo" existia, mas o front não a chamava — e, se
   * chamasse, moveria os arquivos sem reescrever o conteúdo, que continuaria
   * apontando para o endereço antigo. É por isso que as imagens das matérias
   * publicadas moram até hoje em `/uploads/blog/_temp/`.
   */
  async upload(input: {
    file: UploadedFile;
    folder?: MediaFolder;
    articleId?: string;
    sessionId?: string;
    userId: string;
  }) {
    if (input.articleId) {
      await this.requireArticle(input.articleId);
    }

    const folder = input.folder ?? 'images';
    const isAudio = folder === 'audio';
    const sessionId = input.articleId
      ? undefined
      : (input.sessionId ?? `sessao-${randomUUID()}`);

    const asset = await this.storage.uploadFile(
      {
        kind: isAudio
          ? StorageAssetKind.BLOG_AUDIO
          : StorageAssetKind.BLOG_MEDIA,
        scopeId: input.articleId ?? 'rascunhos',
        entityType: input.articleId ? ARTICLE_ASSET_ENTITY : DRAFT_ASSET_ENTITY,
        entityId: input.articleId ?? sessionId,
        ownerId: input.userId,
      },
      input.file,
    );

    if (!asset.secureUrl) {
      throw new InternalServerErrorException(
        'O armazenamento não devolveu o endereço do arquivo',
      );
    }

    return {
      success: true,
      url: asset.secureUrl,
      assetId: asset.id,
      isTemporary: !input.articleId,
      sessionId,
      format: asset.format,
      size: asset.bytes,
      fileType: isAudio ? 'audio' : 'image',
      message: 'Upload realizado com sucesso',
    };
  }

  /**
   * Apaga um arquivo enviado pelo editor, pelo endereço.
   *
   * **A rota do legado nunca funcionou.** Ela montava
   * `public/uploads/uploads/blog/…` — `uploads` duas vezes —, nunca achava o
   * arquivo e respondia 500. E, se achasse, o caminho vinha da query string:
   * `..` apagava fora da pasta.
   *
   * Aqui só arquivo registrado sai, e **só se nenhum artigo ou categoria o
   * usa**. O formulário apaga a capa antiga ao escolher outra, antes de salvar:
   * se a pessoa desistir, o artigo salvo ainda aponta para ela. Por isso
   * arquivo em uso não é apagado — a resposta diz que ficou, sem erro, e a
   * galeria mostra quando ele deixar de ser usado.
   */
  async removeUpload(url: string) {
    const asset = await this.prisma.storedAsset.findFirst({
      where: {
        secureUrl: url,
        kind: { in: BLOG_ASSET_KINDS },
        status: StorageAssetStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (!asset) {
      return {
        success: true,
        deleted: false,
        message: url.startsWith('/uploads/')
          ? 'Arquivo no disco do legado: a API não o alcança. Ele foi desvinculado, não apagado.'
          : 'Arquivo não encontrado entre os enviados pelo blog',
      };
    }

    const usedIn = (await this.usage()).get(url) ?? [];

    if (usedIn.length > 0) {
      return {
        success: true,
        deleted: false,
        usedIn,
        message: `Arquivo mantido: está em uso em ${usedIn.length} lugar(es).`,
      };
    }

    await this.storage.deleteAsset(asset.id);

    return { success: true, deleted: true, message: 'Arquivo apagado' };
  }

  /**
   * Mídia da galeria de um artigo.
   *
   * **O filtro do legado estava invertido.** Ele fazia
   * `inGallery = searchParams.get('inGallery') === 'true'` e depois
   * `if (inGallery !== undefined)` — que é sempre verdadeiro. Sem o parâmetro,
   * a rota filtrava `inGallery: false` e devolvia só o que **não** estava na
   * galeria. Aqui o filtro só vale quando é enviado.
   */
  async listArticleMedia(
    articleId: string,
    query: ListArticleMediaQueryDto,
    viewer?: { role: number },
  ) {
    const article = await this.requireArticle(articleId);

    if (!isPublished(article) && !(viewer && viewer.role >= ROLE_ADMIN)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const media = await this.prisma.blogMedia.findMany({
      where: {
        articleId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.inGallery !== undefined
          ? { inGallery: query.inGallery }
          : {}),
      },
      orderBy: { order: 'asc' },
    });

    return { success: true, media, total: media.length };
  }

  async createMedia(articleId: string, dto: CreateMediaDto) {
    await this.requireArticle(articleId);

    const media = await this.prisma.blogMedia.create({
      data: {
        articleId,
        type: dto.type,
        url: mediaUrl(dto.url, dto.type, 'url'),
        thumbnailUrl: optionalUrl(dto.thumbnailUrl, 'thumbnailUrl'),
        ...this.fields(dto),
      },
    });

    await this.invalidate();

    return { success: true, media, message: 'Mídia adicionada com sucesso' };
  }

  /**
   * Edita a mídia — **só os campos dela.** O legado fazia
   * `blogMedia.update({ data: body })`: o corpo inteiro ia para o Prisma, e
   * `articleId` no corpo mudava a mídia de artigo.
   */
  async updateMedia(id: string, dto: UpdateMediaDto) {
    const current = await this.requireMedia(id);
    const type = dto.type ?? current.type;

    const media = await this.prisma.blogMedia.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.url !== undefined
          ? { url: mediaUrl(dto.url, type, 'url') }
          : {}),
        ...(dto.thumbnailUrl !== undefined
          ? { thumbnailUrl: optionalUrl(dto.thumbnailUrl, 'thumbnailUrl') }
          : {}),
        ...this.fields(dto),
      },
    });

    await this.invalidate();

    return { success: true, media, message: 'Mídia atualizada com sucesso' };
  }

  /**
   * Tira a mídia do artigo — e apaga o arquivo, se ninguém mais o usa.
   *
   * O legado tentava apagar do Cloudinary adivinhando o identificador a partir
   * do endereço (`opus-atlas/<pasta>/<nome>`), o que não bate com o
   * identificador de verdade. Aqui o arquivo é achado pelo registro.
   */
  async deleteMedia(id: string) {
    const current = await this.requireMedia(id);

    await this.prisma.blogMedia.delete({ where: { id } });

    const fileDeleted = await this.deleteIfUnused(current.url);

    await this.invalidate();

    return {
      success: true,
      fileDeleted,
      message: 'Mídia removida com sucesso',
    };
  }

  /**
   * A galeria do painel: todo arquivo do blog, e onde cada um é usado.
   *
   * Mostra também **o que o legado deixou no disco do Next** e o banco ainda
   * referencia — como as imagens em `/uploads/blog/_temp/` —, marcado como
   * `legacy-disk` e sem remoção: a API não alcança aquele disco. A migração
   * (`storage:migrate-local`) é o caminho para trazê-los.
   */
  async gallery(query: GalleryQueryDto) {
    const [assets, usage] = await Promise.all([
      this.prisma.storedAsset.findMany({
        where: {
          kind: { in: BLOG_ASSET_KINDS },
          status: StorageAssetStatus.ACTIVE,
        },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.usage(),
    ]);

    const tracked = new Set(assets.map((asset) => asset.secureUrl));

    const cloudFiles = assets
      .filter((asset) => asset.secureUrl)
      .map((asset) => {
        const url = asset.secureUrl as string;
        const usedIn = usage.get(url) ?? [];
        const isAudio = asset.kind === StorageAssetKind.BLOG_AUDIO;

        return {
          id: asset.id,
          url,
          source: 'cloud' as const,
          type: isAudio ? MediaType.AUDIO : MediaType.IMAGE,
          category: categoryOf(isAudio, asset.entityType, usedIn),
          size: asset.bytes ?? 0,
          formattedSize: formatBytes(asset.bytes ?? 0),
          width: asset.width,
          height: asset.height,
          format: asset.format,
          createdAt: asset.createdAt,
          isTemporary: asset.entityType === DRAFT_ASSET_ENTITY,
          deletable: true,
          isUsed: usedIn.length > 0,
          usedIn,
          usageCount: usedIn.length,
        };
      });

    const legacyFiles = [...usage.entries()]
      .filter(([url]) => url.startsWith('/uploads/') && !tracked.has(url))
      .map(([url, usedIn]) => ({
        id: url,
        url,
        source: 'legacy-disk' as const,
        type: /\.(mp3|wav|ogg|m4a|aac)$/i.test(url)
          ? MediaType.AUDIO
          : MediaType.IMAGE,
        category: 'legacy' as GalleryCategory,
        size: 0,
        formattedSize: '—',
        width: null,
        height: null,
        format: url.split('.').pop() ?? null,
        createdAt: null,
        isTemporary: url.includes('/_temp/'),
        deletable: false,
        isUsed: true,
        usedIn,
        usageCount: usedIn.length,
      }));

    const category = query.category ?? 'all';
    const usageFilter = query.usage ?? 'all';

    const files = [...cloudFiles, ...legacyFiles].filter(
      (file) =>
        (category === 'all' || file.category === category) &&
        (usageFilter === 'all' ||
          (usageFilter === 'used' ? file.isUsed : !file.isUsed)),
    );

    return {
      success: true,
      data: {
        files,
        stats: {
          totalFiles: files.length,
          totalSize: files.reduce((sum, file) => sum + file.size, 0),
          usedFiles: files.filter((file) => file.isUsed).length,
          unusedFiles: files.filter((file) => !file.isUsed).length,
          temporaryFiles: files.filter((file) => file.isTemporary).length,
          legacyDiskFiles: files.filter((file) => file.source === 'legacy-disk')
            .length,
        },
      },
    };
  }

  /**
   * Apaga arquivos pela galeria.
   *
   * **A remoção do legado apagava arquivo arbitrário**:
   * `unlink(path.join(cwd, 'public', url))`, com a URL vinda do corpo. E
   * apagava arquivo em uso sem perguntar. Aqui só sai arquivo registrado, e
   * arquivo em uso só com `force`.
   */
  async deleteFromGallery(dto: DeleteGalleryDto) {
    const urls = dto.fileUrls ?? [];
    const ids = dto.assetIds ?? [];

    if (urls.length === 0 && ids.length === 0) {
      throw new BadRequestException('Informe `fileUrls` ou `assetIds`');
    }

    const assets = await this.prisma.storedAsset.findMany({
      where: {
        kind: { in: BLOG_ASSET_KINDS },
        status: StorageAssetStatus.ACTIVE,
        OR: [
          ...(urls.length ? [{ secureUrl: { in: urls } }] : []),
          ...(ids.length ? [{ id: { in: ids } }] : []),
        ],
      },
      select: { id: true, secureUrl: true },
    });

    const usage = await this.usage();
    const removed: string[] = [];
    const failed: { url: string; error: string }[] = [];

    const found = new Set(
      assets.flatMap((asset) => [asset.id, asset.secureUrl]),
    );

    for (const target of [...urls, ...ids]) {
      if (!found.has(target)) {
        failed.push({
          url: target,
          error: target.startsWith('/uploads/')
            ? 'Arquivo no disco do legado: a API não o alcança'
            : 'Arquivo não encontrado entre os enviados pelo blog',
        });
      }
    }

    for (const asset of assets) {
      const url = asset.secureUrl ?? asset.id;
      const usedIn = asset.secureUrl ? (usage.get(asset.secureUrl) ?? []) : [];

      if (usedIn.length > 0 && !dto.force) {
        failed.push({
          url,
          error: `Em uso em ${usedIn.length} lugar(es). Para apagar mesmo assim, envie \`force: true\`.`,
        });
        continue;
      }

      try {
        await this.storage.deleteAsset(asset.id);

        if (asset.secureUrl) {
          await this.prisma.blogMedia.deleteMany({
            where: { url: asset.secureUrl },
          });
        }

        removed.push(url);
      } catch (error: unknown) {
        failed.push({ url, error: errorMessage(error) });
      }
    }

    if (removed.length > 0) {
      await this.invalidate();
    }

    return {
      success: true,
      data: {
        removed,
        failed,
        summary: { totalRemoved: removed.length, totalFailed: failed.length },
      },
      message: `${removed.length} arquivo(s) removido(s)`,
    };
  }

  /**
   * O artigo adota os arquivos enviados antes de ele existir.
   *
   * Chamado ao gravar o artigo, com os endereços do conteúdo, da capa e da
   * música. Arquivo de rascunho que o artigo usa passa a ser dele — e entra na
   * varredura de órfãos, que confere se o artigo ainda existe.
   */
  async adoptDrafts(articleId: string, urls: string[]): Promise<number> {
    const wanted = [...new Set(urls.filter(Boolean))];

    if (wanted.length === 0) {
      return 0;
    }

    const { count } = await this.prisma.storedAsset.updateMany({
      where: {
        entityType: DRAFT_ASSET_ENTITY,
        secureUrl: { in: wanted },
        status: StorageAssetStatus.ACTIVE,
      },
      data: { entityType: ARTICLE_ASSET_ENTITY, entityId: articleId },
    });

    return count;
  }

  // -------------------------------------------------------------------

  /** Onde cada arquivo é usado — em todos os artigos, rascunhos incluídos. */
  private async usage(): Promise<Map<string, MediaUsage[]>> {
    const [articles, categories, media] = await Promise.all([
      this.prisma.blogArticle.findMany({
        select: {
          id: true,
          title: true,
          slug: true,
          coverImage: true,
          backgroundMusicUrl: true,
          content: true,
        },
      }),
      this.prisma.blogCategory.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          coverImage: true,
        },
      }),
      this.prisma.blogMedia.findMany({
        select: {
          url: true,
          thumbnailUrl: true,
          article: { select: { id: true, title: true, slug: true } },
        },
      }),
    ]);

    return buildUsage({ articles, categories, media });
  }

  private async deleteIfUnused(url: string): Promise<boolean> {
    const asset = await this.prisma.storedAsset.findFirst({
      where: {
        secureUrl: url,
        kind: { in: BLOG_ASSET_KINDS },
        status: StorageAssetStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (!asset || ((await this.usage()).get(url) ?? []).length > 0) {
      return false;
    }

    try {
      await this.storage.deleteAsset(asset.id);
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `Arquivo ${asset.id} não foi apagado: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  private fields(dto: UpdateMediaDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const key of MEDIA_FIELDS) {
      const value = dto[key];

      if (value === undefined) continue;

      data[key] = typeof value === 'string' ? value.trim() || null : value;
    }

    return data;
  }

  private async requireArticle(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }

  private async requireMedia(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Mídia não encontrada');
    }

    const media = await this.prisma.blogMedia.findUnique({
      where: { id },
      select: { id: true, type: true, url: true },
    });

    if (!media) {
      throw new NotFoundException('Mídia não encontrada');
    }

    return media;
  }

  private async invalidate(): Promise<void> {
    // O detalhe do artigo traz a galeria.
    await this.cache.invalidateMany([CacheNamespace.BLOG_ARTICLES]);
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

function categoryOf(
  isAudio: boolean,
  entityType: string | null,
  usedIn: MediaUsage[],
): GalleryCategory {
  if (isAudio) return 'audio';
  if (entityType === DRAFT_ASSET_ENTITY) return 'temp';

  const first = usedIn[0]?.usageType;

  if (first === 'cover') return 'cover';
  if (first === 'gallery') return 'gallery';
  if (first === 'category') return 'category';
  return 'content';
}

function mediaUrl(value: string, type: MediaType, field: string): string {
  return requiredUrl(
    value,
    type === MediaType.VIDEO ? 'media-or-youtube' : 'media',
    field,
  );
}

function optionalUrl(
  value: string | null | undefined,
  field: string,
): string | null {
  return urlField(value, 'media', field) ?? null;
}
