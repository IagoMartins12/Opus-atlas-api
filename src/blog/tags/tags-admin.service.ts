import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { blogSlug } from '../articles/article-text';
import { CreateTagDto, UpdateTagDto } from './dto/write-tag.dto';

/**
 * Administração das tags do blog.
 *
 * **O legado repassava o corpo da requisição inteiro ao Prisma.** A edição
 * fazia `prisma.blogTag.update({ data: body })`, e o Prisma aceita escrita
 * aninhada: `{ "articles": { "deleteMany": {} } }` numa edição de tag
 * desvinculava a tag de todos os artigos. Aqui só os quatro campos da tag
 * chegam ao banco, montados um a um.
 *
 * **O nome também é único, e o legado só conferia o slug.** Criar uma tag com
 * nome já usado passava pela checagem e estourava no índice — um 500.
 */
@Injectable()
export class TagsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async list() {
    const tags = await this.prisma.blogTag.findMany({
      include: { _count: { select: { articles: true } } },
      orderBy: [{ articleCount: 'desc' }, { name: 'asc' }],
    });

    return { success: true, tags };
  }

  async create(dto: CreateTagDto) {
    const name = dto.name.trim();
    const slug = dto.slug ?? blogSlug(name);

    if (!name || !slug) {
      throw new BadRequestException(
        'O nome da tag precisa ter ao menos uma letra ou um número',
      );
    }

    await this.assertFree({ name, slug });

    const tag = await this.prisma.blogTag.create({
      data: {
        name,
        slug,
        description: dto.description?.trim() || null,
        color: dto.color ?? null,
      },
    });

    await this.invalidate();

    return { success: true, tag, message: 'Tag criada com sucesso' };
  }

  async update(id: string, dto: UpdateTagDto) {
    await this.requireTag(id);

    const data: {
      name?: string;
      slug?: string;
      description?: string | null;
      color?: string | null;
    } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      if (!name) {
        throw new BadRequestException('O nome da tag não pode ficar vazio');
      }

      data.name = name;
    }

    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.color !== undefined) data.color = dto.color;

    await this.assertFree({ name: data.name, slug: data.slug }, id);

    const tag = await this.prisma.blogTag.update({ where: { id }, data });

    await this.invalidate();

    return { success: true, tag, message: 'Tag atualizada com sucesso' };
  }

  async remove(id: string) {
    await this.requireTag(id);

    const used = await this.prisma.blogArticleTag.count({
      where: { tagId: id },
    });

    if (used > 0) {
      throw new BadRequestException(
        `Esta tag está em ${used} artigo(s). Tire-a dos artigos antes de apagar.`,
      );
    }

    await this.prisma.blogTag.delete({ where: { id } });
    await this.invalidate();

    return { success: true, message: 'Tag apagada com sucesso' };
  }

  // -------------------------------------------------------------------

  private async requireTag(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Tag não encontrada');
    }

    const tag = await this.prisma.blogTag.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!tag) {
      throw new NotFoundException('Tag não encontrada');
    }

    return tag;
  }

  private async assertFree(
    wanted: { name?: string; slug?: string },
    exceptId?: string,
  ): Promise<void> {
    const or = [
      ...(wanted.name ? [{ name: wanted.name }] : []),
      ...(wanted.slug ? [{ slug: wanted.slug }] : []),
    ];

    if (or.length === 0) {
      return;
    }

    const clash = await this.prisma.blogTag.findFirst({
      where: { OR: or, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true, slug: true },
    });

    if (!clash) {
      return;
    }

    throw new ConflictException(
      clash.slug === wanted.slug
        ? `Já existe uma tag com o slug "${wanted.slug}"`
        : `Já existe uma tag chamada "${clash.name}"`,
    );
  }

  private async invalidate(): Promise<void> {
    // A listagem de artigos traz as tags de cada um: renomear uma tag muda a
    // resposta de lá também.
    await this.cache.invalidateMany([
      CacheNamespace.BLOG_TAGS,
      CacheNamespace.BLOG_ARTICLES,
    ]);
  }
}
