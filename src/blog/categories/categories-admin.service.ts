import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StorageAssetKind } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import {
  StorageService,
  UploadedFile,
} from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { blogSlug } from '../articles/article-text';
import { urlField } from '../shared/url-field';
import {
  CategoryOrderDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/write-category.dto';

/**
 * Como os arquivos da categoria são registrados em `StoredAsset`.
 *
 * O nome segue a convenção do armazenamento — o nome do model, em camelCase
 * (`user`, `workScore`, `blogArticle`) —, que é o que a varredura de órfãos
 * sabe conferir. Com outro formato, o arquivo ficaria fora dela.
 */
export const CATEGORY_ASSET_ENTITY = 'blogCategory';

type CategoryData = Record<string, unknown>;

/**
 * Administração das categorias do blog.
 *
 * **O legado repassava o corpo inteiro ao Prisma na edição parcial**
 * (`data: body`). Como o Prisma aceita escrita aninhada, `{ "articles": {
 * "deleteMany": {} } }` numa edição desvinculava a categoria de todos os
 * artigos. Aqui só os campos da categoria chegam ao banco.
 *
 * **A imagem deixa de ser arquivo no disco do Next.** O legado gravava em
 * `public/uploads/blog/categories` e apagava com
 * `unlink(path.join(cwd, 'public', url))`, com a `url` vinda da query string —
 * e `path.join` resolve `..`: `?url=/../../.env` apagava o `.env` do servidor.
 * Aqui o arquivo vai para o armazenamento em nuvem, registrado em
 * `StoredAsset` pela categoria, e é removido **pela categoria**, nunca por um
 * caminho que o cliente escolhe.
 */
@Injectable()
export class CategoriesAdminService {
  private readonly logger = new Logger(CategoriesAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Todas as categorias, com o número **real** de artigos.
   *
   * A contagem inclui rascunhos, e não só publicados como a leitura pública:
   * é ela que decide se a categoria pode ser apagada, e "0 artigos" seguido de
   * "não é possível apagar" seria o painel mentindo.
   */
  async list() {
    const categories = await this.prisma.blogCategory.findMany({
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: { select: { id: true, name: true, slug: true } },
        _count: { select: { articles: true } },
      },
      orderBy: { order: 'asc' },
    });

    return { success: true, categories };
  }

  async create(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const slug = dto.slug ?? blogSlug(name);

    if (!name || !slug) {
      throw new BadRequestException(
        'O nome da categoria precisa ter ao menos uma letra ou um número',
      );
    }

    await this.assertSlugFree(slug);

    if (dto.parentId) {
      await this.requireCategory(dto.parentId, 'Categoria mãe inexistente');
    }

    const last = await this.prisma.blogCategory.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const category = await this.prisma.blogCategory.create({
      data: {
        ...this.fields(dto),
        name,
        slug,
        order: (last?.order ?? -1) + 1,
      } as Prisma.BlogCategoryUncheckedCreateInput,
    });

    await this.invalidate();

    return { success: true, category, message: 'Categoria criada com sucesso' };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.requireCategory(id);

    const data = this.fields(dto);

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      if (!name) {
        throw new BadRequestException(
          'O nome da categoria não pode ficar vazio',
        );
      }

      data.name = name;
    }

    if (dto.slug !== undefined) {
      await this.assertSlugFree(dto.slug, id);
      data.slug = dto.slug;
    }

    if (dto.parentId) {
      await this.assertParent(id, dto.parentId);
    }

    const category = await this.prisma.blogCategory.update({
      where: { id },
      data: data as Prisma.BlogCategoryUncheckedUpdateInput,
    });

    await this.invalidate();

    return {
      success: true,
      category,
      message: 'Categoria atualizada com sucesso',
    };
  }

  /**
   * Apaga uma categoria vazia.
   *
   * **A rota que o painel usava só conferia artigos, não subcategorias.**
   * Apagar uma categoria mãe deixava as filhas apontando para um `parentId`
   * que não existe mais — e a leitura pública, que inclui `parent`, as trazia
   * com a mãe nula sem que ninguém soubesse por quê.
   */
  async remove(id: string) {
    await this.requireCategory(id);

    const [children, articles] = await Promise.all([
      this.prisma.blogCategory.count({ where: { parentId: id } }),
      this.prisma.blogArticleCategory.count({ where: { categoryId: id } }),
    ]);

    if (children > 0) {
      throw new BadRequestException(
        `Esta categoria tem ${children} subcategoria(s). Mova ou apague as subcategorias antes.`,
      );
    }

    if (articles > 0) {
      throw new BadRequestException(
        `Esta categoria está em ${articles} artigo(s). Tire-a dos artigos antes de apagar.`,
      );
    }

    await this.prisma.blogCategory.delete({ where: { id } });
    await this.removeStoredFiles(id);
    await this.invalidate();

    return { success: true, message: 'Categoria apagada com sucesso' };
  }

  /**
   * Reordena as categorias.
   *
   * O legado gravava a ordem de qualquer id recebido, em paralelo e sem
   * transação: um id inexistente derrubava a rota com 500 depois de parte das
   * posições já gravadas.
   */
  async reorder(items: CategoryOrderDto[]) {
    const ids = items.map((item) => item.id);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Uma mesma categoria aparece duas vezes');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

      for (const item of items) {
        await tx.blogCategory.update({
          where: { id: item.id },
          data: { order: item.order },
        });
      }
    });

    await this.invalidate();

    return { success: true, message: 'Ordem atualizada com sucesso' };
  }

  /**
   * Envia a imagem da categoria.
   *
   * **A categoria precisa existir antes.** No legado o formulário enviava a
   * imagem ao escolher o arquivo, antes de salvar — e se a pessoa desistisse,
   * o arquivo ficava no disco sem dono. Aqui ele nasce ligado à categoria, e
   * a troca apaga o anterior.
   */
  async uploadImage(id: string, file: UploadedFile, userId: string) {
    await this.requireCategory(id);

    const asset = await this.storage.uploadFile(
      {
        kind: StorageAssetKind.BLOG_MEDIA,
        scopeId: id,
        entityType: CATEGORY_ASSET_ENTITY,
        entityId: id,
        ownerId: userId,
      },
      file,
    );

    if (!asset.secureUrl) {
      throw new InternalServerErrorException(
        'O armazenamento não devolveu a URL da imagem',
      );
    }

    const category = await this.prisma.blogCategory.update({
      where: { id },
      data: { image: asset.secureUrl },
    });

    // `BLOG_MEDIA` guarda vários arquivos por entidade (é a galeria do
    // artigo), então a política não apaga o anterior sozinha. Na categoria só
    // existe uma imagem: a troca apaga as outras.
    const previous = await this.storage.findActiveByEntity(
      CATEGORY_ASSET_ENTITY,
      id,
    );

    for (const old of previous.filter((entry) => entry.id !== asset.id)) {
      await this.storage
        .deleteAsset(old.id)
        .catch((error: unknown) =>
          this.logger.warn(
            `Imagem anterior da categoria ${id} não foi apagada: ${errorMessage(error)}`,
          ),
        );
    }

    await this.invalidate();

    return { success: true, url: asset.secureUrl, category };
  }

  /**
   * Tira a imagem da categoria.
   *
   * As imagens gravadas pelo legado moram no disco do Next
   * (`/uploads/blog/categories/...`) e não estão registradas em `StoredAsset`:
   * a API as desvincula da categoria, mas não tem como apagar o arquivo de lá.
   */
  async removeImage(id: string) {
    await this.requireCategory(id);
    await this.removeStoredFiles(id);

    const category = await this.prisma.blogCategory.update({
      where: { id },
      data: { image: null },
    });

    await this.invalidate();

    return { success: true, category, message: 'Imagem removida' };
  }

  // -------------------------------------------------------------------

  /** Campos simples, só os que vieram — nunca o corpo inteiro. */
  private fields(dto: UpdateCategoryDto): CategoryData {
    const data: CategoryData = {};

    const set = (key: string, value: unknown) => {
      if (value !== undefined) data[key] = value;
    };

    set('description', trimmed(dto.description));
    set('icon', trimmed(dto.icon));
    set('color', dto.color);
    // Aceita o que a base já tem — caminho do próprio site, como
    // `/uploads/blog/categories/…` — e endereço http(s).
    set('image', urlField(dto.image, 'media', 'image'));
    set('coverImage', urlField(dto.coverImage, 'media', 'coverImage'));
    set('parentId', dto.parentId);
    set('isActive', dto.isActive);
    set('showInMenu', dto.showInMenu);
    set('metaTitle', trimmed(dto.metaTitle));
    set('metaDescription', trimmed(dto.metaDescription));

    return data;
  }

  /**
   * A categoria mãe precisa existir e não pode estar abaixo desta.
   *
   * O legado só recusava ser mãe de si mesma. Com A mãe de B, tornar B mãe de A
   * passava — e aí nenhuma das duas tem topo, e qualquer percurso pela árvore
   * (menu, trilha de navegação) fica em laço.
   */
  private async assertParent(id: string, parentId: string): Promise<void> {
    if (parentId === id) {
      throw new BadRequestException(
        'Uma categoria não pode ser mãe de si mesma',
      );
    }

    const seen = new Set<string>();
    let cursor: string | null = parentId;

    while (cursor && !seen.has(cursor)) {
      if (cursor === id) {
        throw new BadRequestException(
          'Isso criaria um ciclo: a categoria escolhida como mãe está abaixo desta',
        );
      }

      seen.add(cursor);

      const node: { parentId: string | null } | null =
        await this.prisma.blogCategory.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });

      if (!node) {
        if (cursor === parentId) {
          throw new BadRequestException('Categoria mãe inexistente');
        }

        return;
      }

      cursor = node.parentId;
    }
  }

  private async requireCategory(
    id: string,
    message = 'Categoria não encontrada',
  ) {
    const notFound = () =>
      message === 'Categoria não encontrada'
        ? new NotFoundException(message)
        : new BadRequestException(message);

    if (!isMongoId(id)) {
      throw notFound();
    }

    const category = await this.prisma.blogCategory.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!category) {
      throw notFound();
    }

    return category;
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const taken = await this.prisma.blogCategory.findFirst({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictException(
        `Já existe uma categoria com o slug "${slug}"`,
      );
    }
  }

  private async removeStoredFiles(id: string): Promise<void> {
    await this.storage
      .deleteByEntity(CATEGORY_ASSET_ENTITY, id)
      .catch((error: unknown) =>
        this.logger.warn(
          `Arquivos da categoria ${id} não foram apagados: ${errorMessage(error)}`,
        ),
      );
  }

  private async invalidate(): Promise<void> {
    // A listagem de artigos traz as categorias de cada um.
    await this.cache.invalidateMany([
      CacheNamespace.BLOG_CATEGORIES,
      CacheNamespace.BLOG_ARTICLES,
    ]);
  }
}

function trimmed(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}
