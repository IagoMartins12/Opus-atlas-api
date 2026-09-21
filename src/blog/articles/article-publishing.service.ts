import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { featuredFields } from './article-featured';
import {
  ArticleStatusError,
  PublishAction,
  scheduledPublication,
  statusFields,
  targetOf,
} from './article-status';
import { FeaturedOrderDto } from './dto/write-article.dto';

/** Quantos agendados uma passada da varredura publica, no máximo. */
const SWEEP_BATCH = 200;

const DONE: Record<PublishAction, string> = {
  publish: 'publicado',
  unpublish: 'despublicado',
  schedule: 'agendado',
};

/**
 * Publicação, aprovação e destaque de artigos.
 *
 * Separado da escrita porque não mexe no texto: nenhuma destas ações grava
 * versão, como no legado.
 */
@Injectable()
export class ArticlePublishingService {
  private readonly logger = new Logger(ArticlePublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  async publish(id: string, action: PublishAction, scheduledFor?: string) {
    const current = await this.requireState(id);
    const fields = this.transition(
      current,
      targetOf(action),
      scheduledFor ? new Date(scheduledFor) : null,
    );

    const article = await this.prisma.blogArticle.update({
      where: { id },
      data: fields,
    });

    await this.invalidate();

    return {
      success: true,
      article,
      message: `Artigo ${DONE[action]} com sucesso`,
    };
  }

  /**
   * Aprova e publica.
   *
   * **O legado respondia com redirecionamento**, porque a aprovação era um
   * `<form>` da página de pré-visualização postando para a rota e o navegador
   * seguia para `/blog/<slug>`. Uma API não decide para onde o navegador vai:
   * aqui a resposta traz o `slug`, e o front navega.
   */
  async approve(id: string) {
    const current = await this.requireState(id);
    const fields = this.transition(current, ArticleStatus.PUBLISHED, null);

    const article = await this.prisma.blogArticle.update({
      where: { id },
      data: fields,
      select: { id: true, slug: true, status: true, publishedAt: true },
    });

    await this.invalidate();

    return { success: true, article, message: 'Artigo aprovado e publicado' };
  }

  async feature(id: string, isFeatured: boolean, featuredOrder?: number) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const current = await tx.blogArticle.findUnique({
          where: { id },
          select: { id: true, isFeatured: true, featuredOrder: true },
        });

        if (!current) {
          throw new NotFoundException('Artigo não encontrado');
        }

        const fields = await featuredFields(
          tx,
          isFeatured,
          featuredOrder,
          current,
        );

        return tx.blogArticle.update({ where: { id }, data: fields });
      },
    );

    await this.invalidate();

    return {
      success: true,
      article,
      message: isFeatured
        ? 'Artigo marcado como destaque'
        : 'Artigo removido dos destaques',
    };
  }

  /**
   * Reordena o carrossel.
   *
   * **O legado reordenava qualquer id que chegasse**, inclusive de artigo fora
   * do destaque — que ganhava posição no carrossel sem estar nele — e um id
   * inexistente derrubava a rota com 500 depois de parte das posições já
   * gravadas, porque as atualizações iam em paralelo e sem transação.
   */
  async reorderFeatured(items: FeaturedOrderDto[]) {
    const ids = items.map((item) => item.id);
    const orders = items.map((item) => item.featuredOrder);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Um mesmo artigo aparece duas vezes');
    }

    if (new Set(orders).size !== orders.length) {
      throw new BadRequestException('Duas posições iguais no carrossel');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const found = await tx.blogArticle.findMany({
        where: { id: { in: ids } },
        select: { id: true, isFeatured: true },
      });
      const featured = new Set(
        found.filter((article) => article.isFeatured).map((a) => a.id),
      );
      const invalid = ids.filter((id) => !featured.has(id));

      if (invalid.length > 0) {
        throw new BadRequestException(
          `Fora do destaque, ou inexistentes: ${invalid.join(', ')}`,
        );
      }

      for (const item of items) {
        await tx.blogArticle.update({
          where: { id: item.id },
          data: { featuredOrder: item.featuredOrder },
        });
      }
    });

    await this.invalidate();

    return { success: true, message: 'Ordem atualizada com sucesso' };
  }

  /**
   * Publica os artigos cuja data agendada chegou.
   *
   * **No legado, artigo agendado nunca era publicado.** A ação de agendar
   * gravava `status: SCHEDULED` e zerava `publishedAt`, e nada — nenhuma rota,
   * nenhum cron, nenhuma configuração de Vercel — voltava a olhar para ele.
   * Toda leitura pública filtra por `PUBLISHED`: o artigo ficava invisível para
   * sempre, e agendar era, na prática, esconder.
   *
   * A gravação é **condicional ao estado lido** (`status` e `scheduledFor` no
   * `where`): se o autor reagendou ou despublicou entre a consulta e a
   * gravação, nada acontece com aquele artigo. É o que torna a varredura segura
   * de rodar de novo, e de rodar em paralelo com a edição.
   */
  async publishDue(now: Date = new Date()) {
    const due = await this.prisma.blogArticle.findMany({
      where: {
        status: ArticleStatus.SCHEDULED,
        scheduledFor: { lte: now },
      },
      select: { id: true, title: true, scheduledFor: true },
      orderBy: { scheduledFor: 'asc' },
      take: SWEEP_BATCH,
    });

    let published = 0;

    for (const article of due) {
      if (!article.scheduledFor) {
        continue;
      }

      const { count } = await this.prisma.blogArticle.updateMany({
        where: {
          id: article.id,
          status: ArticleStatus.SCHEDULED,
          scheduledFor: article.scheduledFor,
        },
        data: scheduledPublication(article.scheduledFor),
      });

      if (count > 0) {
        published += count;
        this.logger.log(`Agendado publicado: "${article.title}"`);
      }
    }

    if (published > 0) {
      await this.invalidate();
    }

    return { due: due.length, published };
  }

  // -------------------------------------------------------------------

  private transition(
    current: {
      status: ArticleStatus;
      publishedAt: Date | null;
      scheduledFor: Date | null;
    },
    target: ArticleStatus,
    scheduledFor: Date | null,
  ) {
    try {
      return statusFields(current, target, scheduledFor, new Date());
    } catch (error: unknown) {
      if (error instanceof ArticleStatusError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  private async requireState(id: string) {
    if (!isMongoId(id)) {
      throw new NotFoundException('Artigo não encontrado');
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      select: { status: true, publishedAt: true, scheduledFor: true },
    });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }

  private async invalidate(): Promise<void> {
    await this.cache.invalidateMany([
      CacheNamespace.BLOG_ARTICLES,
      CacheNamespace.BLOG_TAGS,
      CacheNamespace.BLOG_CATEGORIES,
    ]);
  }
}
