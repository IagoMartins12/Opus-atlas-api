import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import { StorageService } from '../../common/storage/storage.service';
import { RequestContext } from '../shared/upload-history.service';
import { NotificationsService } from '../../portal/notifications/notifications.service';
import {
  CommentStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { ListModerationQueryDto } from './dto/list-moderation-query.dto';
import { ReportableEntity, ReportUploadDto } from './dto/report-upload.dto';
import { ResolveModerationDto } from './dto/resolve-moderation.dto';
import {
  isGrave,
  isReportCategory,
  priorityOf,
  REPORT_CATEGORIES,
  ReportPriority,
} from './report-categories';
import { hoursToDeadline, isOverdue, SLA_HOURS } from './moderation-sla';

/** Como cada tipo de entidade denunciável é lido e removido. */
const ENTITY_HANDLERS = {
  composer: {
    storageEntity: 'composer',
    select: {
      id: true,
      name: true,
      fullName: true,
      portraitUrl: true,
      isVerified: true,
      createdBy: true,
      createdAt: true,
    },
  },
  work: {
    storageEntity: 'work',
    select: {
      id: true,
      title: true,
      subtitle: true,
      isVerified: true,
      // A fila mostra o compositor da obra denunciada.
      composer: { select: { name: true, fullName: true } },
      createdBy: true,
      createdAt: true,
    },
  },
  score: {
    storageEntity: 'workScore',
    select: {
      id: true,
      title: true,
      downloadUrl: true,
      uploadedBy: true,
      // A fila mostra (e liga para) a obra da partitura denunciada.
      work: { select: { id: true, title: true } },
      createdAt: true,
    },
  },
  'blog-comment': {
    // Comentário não tem arquivo; a chave existe para o mapa ficar completo.
    storageEntity: 'blog-comment',
    select: {
      id: true,
      content: true,
      userId: true,
      articleId: true,
      status: true,
      createdAt: true,
    },
  },
} as const;

/** As categorias que disparam providência imediata. */
const GRAVE_CATEGORIES = Object.entries(REPORT_CATEGORIES)
  .filter(([, value]) => value.grave)
  .map(([id]) => id);

/** A prioridade gravada, estreitada — denúncia antiga não tem categoria. */
function reportPriority(value: string | null): ReportPriority {
  return value === 'urgent' || value === 'high' || value === 'low'
    ? value
    : 'normal';
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Registra uma denúncia da comunidade.
   *
   * A denúncia duplicada do mesmo usuário sobre o mesmo item é recusada: sem
   * isso, uma pessoa sozinha poderia encher a fila de moderação com o mesmo
   * conteúdo e afundar as denúncias legítimas.
   */
  async report(userId: string, dto: ReportUploadDto, context: RequestContext) {
    const entity = await this.loadEntity(dto.entityType, dto.entityId);

    if (!entity) {
      throw new NotFoundException('Conteúdo denunciado não encontrado');
    }

    const existing = await this.prisma.uploadModeration.findFirst({
      where: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        reportedBy: userId,
        status: 'pending',
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Você já denunciou este item. Aguarde a análise.',
      );
    }

    const report = await this.prisma.uploadModeration.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        reportedBy: userId,
        reason: dto.reason,
        description: dto.description,
        category: dto.category,
        // **A prioridade vem da categoria, não de quem denuncia.** Deixar o
        // denunciante escolher a urgência é deixá-lo furar a fila.
        priority: priorityOf(dto.category),
        status: 'pending',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    if (isGrave(dto.category)) {
      await this.holdContent(dto.entityType, dto.entityId, entity);
    }

    return report;
  }

  /**
   * Providência imediata para denúncia grave (RN-4).
   *
   * **A retirada automática vale para o arquivo, não para a ficha.** Uma
   * partitura sai do catálogo na hora: `isActive: false` já é respeitado pela
   * leitura pública (`works.service.ts`), e é o arquivo que uma reclamação de
   * direito autoral atinge. Obra e compositor são **ficha** — título, datas,
   * tonalidade —, e derrubá-las automaticamente daria a qualquer usuário
   * autenticado um botão para sumir com dado do catálogo. Nelas fica registrada
   * a contestação (`verificationStatus: 'disputed'`, o rótulo que o schema já
   * previa e ninguém escrevia), e o prazo de 24h é quem cobre o resto.
   *
   * **O selo de verificação não é mexido.** Tirá-lo aqui seria o mesmo botão de
   * vandalismo por outro caminho: quem confere é gente.
   */
  private async holdContent(
    entityType: ReportableEntity,
    entityId: string,
    entity: {
      createdBy?: string | null;
      uploadedBy?: string | null;
      userId?: string | null;
    } | null,
  ): Promise<void> {
    if (entityType === 'score') {
      await this.prisma.workScore.update({
        where: { id: entityId },
        data: { isActive: false },
      });
    } else if (entityType === 'work') {
      await this.prisma.work.update({
        where: { id: entityId },
        data: { verificationStatus: 'disputed' },
      });
    } else if (entityType === 'composer') {
      await this.prisma.composer.update({
        where: { id: entityId },
        data: { verificationStatus: 'disputed' },
      });
    } else {
      // Comentário é o próprio conteúdo, como a partitura é o próprio arquivo:
      // sai do ar na hora. A leitura pública só mostra `APPROVED`.
      await this.prisma.blogComment.update({
        where: { id: entityId },
        data: { status: CommentStatus.FLAGGED, isFlagged: true },
      });
    }

    await this.invalidateCatalogCache();
    await this.notifyAuthor(entityType, entityId, entity);
  }

  /**
   * Avisa quem enviou o conteúdo.
   *
   * **Quem teve conteúdo retirado precisa saber, e por quê.** Retirar em
   * silêncio é como o autor descobre pela ausência, sem ter o que responder.
   * O tipo é `GENERAL_ANNOUNCEMENT` por não haver um específico de moderação no
   * enum — criar um exigiria `db push`, e o texto já diz do que se trata.
   */
  private async notifyAuthor(
    entityType: ReportableEntity,
    entityId: string,
    entity: {
      createdBy?: string | null;
      uploadedBy?: string | null;
      userId?: string | null;
    } | null,
  ): Promise<void> {
    const authorId = entity?.uploadedBy ?? entity?.createdBy ?? entity?.userId;

    if (!authorId) {
      return;
    }

    const { title, message } = holdNotice(entityType);

    await this.notifications.notify({
      userId: authorId,
      type: NotificationType.GENERAL_ANNOUNCEMENT,
      priority: NotificationPriority.HIGH,
      title,
      message,
      relatedEntityType: entityType,
      relatedEntityId: entityId,
      // Uma denúncia por item já basta para avisar; cinco denúncias do mesmo
      // conteúdo não viram cinco avisos.
      uniqueHash: `moderation-hold:${entityType}:${entityId}`,
    });
  }

  /** Fila de moderação, com o conteúdo denunciado já resolvido. */
  /**
   * Números da fila — o substituto de `reports/stats`, `quick-stats` e
   * `summary` do legado, que eram três contagens diferentes da mesma coisa.
   *
   * "Vencidas" usa o prazo da RN-4 por prioridade, contado no banco.
   */
  async stats(days = 30) {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const pending = { status: 'pending' };

    const [
      byStatus,
      pendingByPriority,
      pendingByEntity,
      byCategory,
      overdue,
      reported,
      resolved,
    ] = await Promise.all([
      this.prisma.uploadModeration.groupBy({ by: ['status'], _count: true }),
      this.prisma.uploadModeration.groupBy({
        by: ['priority'],
        where: pending,
        _count: true,
      }),
      this.prisma.uploadModeration.groupBy({
        by: ['entityType'],
        where: pending,
        _count: true,
      }),
      this.prisma.uploadModeration.groupBy({
        by: ['category'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.uploadModeration.count({
        where: {
          ...pending,
          OR: Object.entries(SLA_HOURS).map(([priority, hours]) => ({
            priority,
            createdAt: { lt: new Date(now.getTime() - hours * 60 * 60 * 1000) },
          })),
        },
      }),
      this.prisma.uploadModeration.count({
        where: { createdAt: { gte: since } },
      }),
      this.prisma.uploadModeration.findMany({
        where: { resolvedAt: { gte: since } },
        select: { createdAt: true, resolvedAt: true },
        take: 5_000,
      }),
    ]);

    const tally = <T extends { _count: number }>(
      rows: T[],
      key: (row: T) => string | null,
    ) => Object.fromEntries(rows.map((row) => [key(row) ?? 'sem', row._count]));

    const resolutionHours = resolved
      .filter((row) => row.resolvedAt)
      .map(
        (row) =>
          (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 3_600_000,
      );

    return {
      generatedAt: now,
      byStatus: tally(byStatus, (row) => row.status),
      pending: {
        total: pendingByPriority.reduce((sum, row) => sum + row._count, 0),
        overdue,
        byPriority: tally(pendingByPriority, (row) => row.priority),
        byEntityType: tally(pendingByEntity, (row) => row.entityType),
      },
      period: {
        days,
        since,
        reported,
        resolved: resolutionHours.length,
        // `null` sem nada resolvido: média de zero itens não é zero hora.
        avgResolutionHours: resolutionHours.length
          ? Math.round(
              (resolutionHours.reduce((a, b) => a + b, 0) /
                resolutionHours.length) *
                10,
            ) / 10
          : null,
        byCategory: tally(byCategory, (row) => row.category),
      },
    };
  }

  async list(query: ListModerationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? 'pending';
    const where: Prisma.UploadModerationWhereInput = {
      ...(status !== 'all' ? { status } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };

    const [reports, total] = await Promise.all([
      this.prisma.uploadModeration.findMany({
        where,
        include: {
          reporter: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          moderator: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        // **Ordenada por prioridade e depois por idade.** Ordenar só por data
        // punha uma denúncia comum de hoje na frente de uma urgente de ontem,
        // que é o oposto do que um prazo serve para fazer.
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.uploadModeration.count({ where }),
    ]);

    const now = new Date();

    const enriched = await Promise.all(
      reports.map(async (report) => {
        const priority = reportPriority(report.priority);

        return {
          ...report,
          categoryLabel: isReportCategory(report.category ?? '')
            ? REPORT_CATEGORIES[
                report.category as keyof typeof REPORT_CATEGORIES
              ].label
            : null,
          // O prazo é o que a fila mostra: sem ele, "urgente" é só uma palavra.
          slaHoursLeft: hoursToDeadline(report.createdAt, priority, now),
          overdue: isOverdue(report.createdAt, priority, now),
          entity: await this.loadEntity(
            report.entityType as ReportableEntity,
            report.entityId,
          ),
        };
      }),
    );

    return {
      reports: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Resolve uma denúncia.
   *
   * `delete` remove o conteúdo denunciado **e** os arquivos associados. Antes,
   * a exclusão só derrubava a linha do banco e o arquivo continuava acessível
   * por URL direta — conteúdo removido por violação seguia no ar para quem
   * tivesse o link.
   */
  async resolve(
    moderatorId: string,
    moderationId: string,
    dto: ResolveModerationDto,
  ) {
    const moderation = await this.prisma.uploadModeration.findUnique({
      where: { id: moderationId },
    });

    if (!moderation) {
      throw new NotFoundException('Denúncia não encontrada');
    }

    if (moderation.status !== 'pending') {
      throw new BadRequestException('Esta denúncia já foi processada');
    }

    // **Remover exige motivo escrito (RN-4).** Aprovar em silêncio tudo bem —
    // o conteúdo fica onde está e nada se perde. Derrubar o trabalho de alguém
    // sem uma linha dizendo por quê deixa o autor sem o que responder e a
    // plataforma sem como sustentar a decisão depois.
    if (dto.action === 'delete' && !dto.notes?.trim()) {
      throw new BadRequestException(
        'Remover conteúdo denunciado exige uma justificativa em `notes`.',
      );
    }

    const entityType = moderation.entityType as ReportableEntity;

    if (dto.action === 'delete') {
      await this.deleteReportedEntity(entityType, moderation.entityId);
      await this.invalidateCatalogCache();
    } else {
      // **A retenção automática é soltada quando o conteúdo fica.** Sem isso,
      // uma denúncia grave arquivada deixaria a partitura fora do catálogo
      // para sempre — o efeito de uma denúncia improcedente seria idêntico ao
      // de uma procedente.
      await this.releaseHold(entityType, moderation.entityId);
    }

    return this.prisma.uploadModeration.update({
      where: { id: moderationId },
      data: {
        status: dto.action === 'reject' ? 'rejected' : 'approved',
        moderatedBy: moderatorId,
        moderationNotes: dto.notes,
        resolution: dto.action,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Resolve várias denúncias de uma vez.
   *
   * **Reusa a resolução singular, uma a uma.** O legado reimplementava o laço
   * inteiro dentro da rota de lote, e a cópia divergiu da original em duas
   * coisas que importam: não removia os **arquivos** do conteúdo apagado — o
   * material denunciado continuava acessível por URL direta — e não invalidava
   * o cache do catálogo. Uma denúncia resolvida em lote tinha efeito diferente
   * da mesma denúncia resolvida sozinha.
   *
   * Aqui o comportamento é o mesmo por construção: se a regra mudar, muda para
   * os dois caminhos.
   *
   * **Uma falha não derruba as outras.** Denúncia já processada, entidade que
   * sumiu no meio, arquivo que o provedor recusou apagar — cada caso vira uma
   * linha de resultado, e as demais seguem. Interromper o lote no primeiro erro
   * deixaria o moderador sem saber o que foi feito e o que não foi.
   */
  async resolveMany(
    moderatorId: string,
    moderationIds: string[],
    dto: ResolveModerationDto,
  ) {
    const outcomes: {
      moderationId: string;
      status: 'resolved' | 'failed';
      reason?: string;
    }[] = [];

    for (const moderationId of moderationIds) {
      try {
        await this.resolve(moderatorId, moderationId, dto);
        outcomes.push({ moderationId, status: 'resolved' });
      } catch (error: unknown) {
        outcomes.push({
          moderationId,
          status: 'failed',
          reason: errorMessage(error),
        });

        this.logger.warn(
          `Denúncia ${moderationId} não pôde ser resolvida em lote: ${errorMessage(error)}`,
        );
      }
    }

    const resolved = outcomes.filter(
      (outcome) => outcome.status === 'resolved',
    ).length;

    return {
      action: dto.action,
      requested: moderationIds.length,
      resolved,
      failed: outcomes.length - resolved,
      outcomes,
    };
  }

  /**
   * Fecha as denúncias pendentes de um item decidido por outro caminho.
   *
   * O painel do blog modera comentário direto pelo estado (aprovar, reprovar,
   * spam). Sem fechar as denúncias junto, a decisão ficaria tomada no
   * comentário e a denúncia continuaria pendente na fila — e a varredura de
   * prazo avisaria os administradores sobre algo já resolvido.
   */
  async closePendingFor(input: {
    entityType: ReportableEntity;
    entityId: string;
    moderatorId: string;
    resolution: 'approve' | 'delete';
    notes: string | null;
  }): Promise<number> {
    const { count } = await this.prisma.uploadModeration.updateMany({
      where: {
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'pending',
      },
      data: {
        // Mesmo significado de `resolve`: fechada, com a decisão em `resolution`.
        status: 'approved',
        moderatedBy: input.moderatorId,
        moderationNotes: input.notes,
        resolution: input.resolution,
        resolvedAt: new Date(),
      },
    });

    return count;
  }

  // -------------------------------------------------------------------

  private async loadEntity(entityType: ReportableEntity, entityId: string) {
    switch (entityType) {
      case 'composer':
        return this.prisma.composer.findUnique({
          where: { id: entityId },
          select: ENTITY_HANDLERS.composer.select,
        });
      case 'work':
        return this.prisma.work.findUnique({
          where: { id: entityId },
          select: ENTITY_HANDLERS.work.select,
        });
      case 'score':
        return this.prisma.workScore.findUnique({
          where: { id: entityId },
          select: ENTITY_HANDLERS.score.select,
        });
      case 'blog-comment':
        return this.prisma.blogComment.findUnique({
          where: { id: entityId },
          select: ENTITY_HANDLERS['blog-comment'].select,
        });
    }
  }

  private async deleteReportedEntity(
    entityType: ReportableEntity,
    entityId: string,
  ): Promise<void> {
    // **Remover comentário é tirá-lo do ar, não apagá-lo.** Apagar levaria
    // junto as respostas de outras pessoas, e a trilha de moderação perderia o
    // texto que foi julgado. `REJECTED` esconde da leitura pública e é
    // reversível pelo painel do blog.
    if (entityType === 'blog-comment') {
      await this.prisma.blogComment.update({
        where: { id: entityId },
        data: {
          status: CommentStatus.REJECTED,
          isFlagged: false,
          moderatedAt: new Date(),
        },
      });
      return;
    }

    await this.storage.deleteByEntity(
      ENTITY_HANDLERS[entityType].storageEntity,
      entityId,
    );

    switch (entityType) {
      case 'composer':
        await this.prisma.composer.delete({ where: { id: entityId } });
        return;
      case 'work':
        await this.prisma.work.delete({ where: { id: entityId } });
        return;
      case 'score':
        await this.prisma.workScore.delete({ where: { id: entityId } });
        return;
    }
  }

  /** Desfaz a retenção posta por uma denúncia grave. */
  private async releaseHold(
    entityType: ReportableEntity,
    entityId: string,
  ): Promise<void> {
    // Só desfaz se ainda houver outra denúncia grave pendente sobre o mesmo
    // item — duas denúncias e uma decisão não podem devolver o conteúdo.
    const outrasGraves = await this.prisma.uploadModeration.count({
      where: {
        entityType,
        entityId,
        status: 'pending',
        category: { in: GRAVE_CATEGORIES },
      },
    });

    if (outrasGraves > 0) {
      return;
    }

    if (entityType === 'score') {
      await this.prisma.workScore.updateMany({
        where: { id: entityId, isActive: false },
        data: { isActive: true },
      });
    } else if (entityType === 'work') {
      await this.prisma.work.updateMany({
        where: { id: entityId, verificationStatus: 'disputed' },
        data: { verificationStatus: 'pending' },
      });
    } else if (entityType === 'composer') {
      await this.prisma.composer.updateMany({
        where: { id: entityId, verificationStatus: 'disputed' },
        data: { verificationStatus: 'pending' },
      });
    } else {
      await this.prisma.blogComment.updateMany({
        where: { id: entityId, status: CommentStatus.FLAGGED },
        data: { status: CommentStatus.APPROVED, isFlagged: false },
      });
    }

    await this.invalidateCatalogCache();
  }

  private async invalidateCatalogCache(): Promise<void> {
    await this.cache.invalidateMany(CATALOG_NAMESPACES);
  }
}

/** O aviso a quem teve conteúdo retido por denúncia grave. */
function holdNotice(entityType: ReportableEntity): {
  title: string;
  message: string;
} {
  if (entityType === 'blog-comment') {
    return {
      title: 'Seu comentário saiu do ar para análise',
      message:
        'Recebemos uma denúncia grave sobre um comentário seu, e ele saiu do ' +
        'ar enquanto a equipe analisa. Você será avisado do resultado.',
    };
  }

  if (entityType === 'score') {
    return {
      title: 'Seu envio saiu do catálogo para análise',
      message:
        'Recebemos uma denúncia grave sobre um item que você enviou e ele ' +
        'saiu do catálogo enquanto a equipe analisa. Você será avisado do ' +
        'resultado.',
    };
  }

  return {
    title: 'Seu envio foi contestado',
    message:
      'Recebemos uma denúncia grave sobre um item que você enviou. Ele ' +
      'continua no catálogo e a equipe vai analisar.',
  };
}
