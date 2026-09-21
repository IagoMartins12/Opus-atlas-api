import { toCsv } from '../../common/utils/csv.util';
import { escapeRegex } from '../../common/utils/regex.util';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ScoreSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { ListMyUploadsQueryDto } from './dto/list-my-uploads-query.dto';
import {
  MyUploadItemDto,
  MyUploadsResponseDto,
} from './dto/my-uploads-response.dto';

/** Recorte de tempo usado nas estatísticas. */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

const EXPORT_LIMIT = 5_000;

/** "Meus envios": na visão de todos os tipos, até 16 de cada. */
const MY_UPLOADS_PER_TYPE = 16;

type MyUploadKind = 'composer' | 'work' | 'score';
// O filtro de texto já montado, com o termo escapado (ver `listMine`).
type MyUploadsContains = Pick<Prisma.StringFilter, 'contains' | 'mode'>;

const MY_COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  createdAt: true,
  updatedAt: true,
  imslpId: true,
  dataQuality: true,
  verificationStatus: true,
  epoch: { select: { name: true } },
} satisfies Prisma.ComposerSelect;

const MY_WORK_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  imslpId: true,
  imslpPermlink: true,
  composer: { select: { id: true, name: true, fullName: true } },
  epoch: { select: { name: true } },
  instrument: { select: { name: true } },
  workGenresArr: true,
  categoryNames: true,
} satisfies Prisma.WorkSelect;

const MY_SCORE_SELECT = {
  id: true,
  title: true,
  source: true,
  fileSize: true,
  pageCount: true,
  downloadUrl: true,
  dataQuality: true,
  verificationStatus: true,
  createdAt: true,
  updatedAt: true,
  work: {
    select: {
      id: true,
      title: true,
      composer: { select: { id: true, name: true, fullName: true } },
    },
  },
} satisfies Prisma.WorkScoreSelect;

@Injectable()
export class UploadHistoryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Histórico de contribuições.
   *
   * Usuário comum só enxerga as próprias. Consultar as de outra pessoa exige
   * moderação — no legado o parâmetro `userId` era aceito de qualquer um, então
   * bastava passar o id alheio para ler o histórico de contribuições dele.
   */
  /** O mesmo filtro para a listagem e a exportação — e a mesma regra de quem vê. */
  private buildWhere(
    requesterId: string,
    isModerator: boolean,
    query: ListHistoryQueryDto,
  ): Prisma.UploadHistoryWhereInput {
    if (query.userId && query.userId !== requesterId && !isModerator) {
      throw new ForbiddenException(
        'Você só pode consultar o próprio histórico de contribuições',
      );
    }

    const where: Prisma.UploadHistoryWhereInput = {
      userId: query.userId ?? requesterId,
    };

    if (query.type && query.type !== 'all') {
      where.entityType = query.type;
    }

    if (query.action && query.action !== 'all') {
      where.action = query.action;
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.reason) {
      where.reason = {
        contains: escapeRegex(query.reason),
        mode: 'insensitive',
      };
    }

    if (query.dateFrom || query.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};

      if (query.dateFrom) {
        createdAt.gte = new Date(query.dateFrom);
      }

      if (query.dateTo) {
        // O fim do período inclui o dia inteiro: sem isso, filtrar "até hoje"
        // esconderia tudo o que foi feito hoje depois da meia-noite.
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }

      where.createdAt = createdAt;
    }

    return where;
  }

  /**
   * Exportação do histórico — o `POST /uploads/history` do legado era isto.
   *
   * Até 5.000 registros, em JSON ou CSV. **Sem IP nem navegador**: são dados
   * pessoais de quem contribuiu, guardados para investigar abuso, não para
   * circular numa planilha.
   */
  async export(
    requesterId: string,
    isModerator: boolean,
    query: ListHistoryQueryDto,
    format: 'json' | 'csv',
  ) {
    const entries = await this.prisma.uploadHistory.findMany({
      where: this.buildWhere(requesterId, isModerator, query),
      select: {
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMIT,
    });

    if (format === 'json') {
      return {
        entries,
        total: entries.length,
        truncated: entries.length === EXPORT_LIMIT,
      };
    }

    return {
      csv: toCsv(
        ['Data', 'Ação', 'Tipo', 'Id do item', 'Motivo', 'Usuário'],
        entries.map((entry) => [
          entry.createdAt.toISOString(),
          entry.action,
          entry.entityType,
          entry.entityId,
          entry.reason ?? '',
          [entry.user.firstName, entry.user.lastName].filter(Boolean).join(' '),
        ]),
      ),
    };
  }

  async list(
    requesterId: string,
    isModerator: boolean,
    query: ListHistoryQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = this.buildWhere(requesterId, isModerator, query);

    const orderBy = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    } as Prisma.UploadHistoryOrderByWithRelationInput;

    const [entries, total] = await Promise.all([
      this.prisma.uploadHistory.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, image: true },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.uploadHistory.count({ where }),
    ]);

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Últimas contribuições do usuário, para o resumo da página de uploads. */
  async recent(userId: string, limit = 10) {
    return this.prisma.uploadHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        changes: true,
        createdAt: true,
      },
    });
  }

  /**
   * Estatísticas de contribuição do usuário.
   *
   * Todas as contagens saem numa única rodada de consultas paralelas em vez de
   * sequenciais — o painel de uploads carrega os seis números de uma vez.
   */
  async stats(userId: string) {
    const where: Prisma.UploadHistoryWhereInput = { userId };

    const [total, last7Days, last30Days, byEntity, byAction] =
      await Promise.all([
        this.prisma.uploadHistory.count({ where }),
        this.prisma.uploadHistory.count({
          where: { ...where, createdAt: { gte: daysAgo(7) } },
        }),
        this.prisma.uploadHistory.count({
          where: { ...where, createdAt: { gte: daysAgo(30) } },
        }),
        this.prisma.uploadHistory.groupBy({
          by: ['entityType'],
          where,
          _count: { _all: true },
        }),
        this.prisma.uploadHistory.groupBy({
          by: ['action'],
          where,
          _count: { _all: true },
        }),
      ]);

    return {
      total,
      last7Days,
      last30Days,
      byEntityType: Object.fromEntries(
        byEntity.map((row) => [row.entityType, row._count._all]),
      ),
      byAction: Object.fromEntries(
        byAction.map((row) => [row.action, row._count._all]),
      ),
    };
  }

  /**
   * Números do que o usuário tem publicado hoje, não do que ele já fez.
   *
   * É diferente do histórico: apagar uma obra remove a contribuição do total
   * atual, mas a linha de histórico do envio permanece.
   */
  async contributionTotals(userId: string) {
    const [composers, works, scores, pendingReports] = await Promise.all([
      this.prisma.composer.count({ where: { createdBy: userId } }),
      this.prisma.work.count({ where: { createdBy: userId } }),
      this.prisma.workScore.count({ where: { uploadedBy: userId } }),
      this.prisma.uploadModeration.count({
        where: { reportedBy: userId, status: 'pending' },
      }),
    ]);

    return {
      composers,
      works,
      scores,
      total: composers + works + scores,
      pendingReports,
    };
  }

  /**
   * "Meus envios" (`/upload` no front): os compositores, obras e partituras que
   * a pessoa criou, com busca, filtros, paginação e a contagem de cada tipo.
   *
   * É a regra do legado (`getUserUploads`), com duas diferenças: o texto de
   * busca é escapado, e o compositor da obra e a obra da partitura entram pelos
   * ids, dentro do que a própria pessoa criou — filtrar pela relação faz o
   * Prisma montar um `$lookup` em cada documento (ver `works.service`).
   */
  async listMine(
    userId: string,
    query: ListMyUploadsQueryDto,
  ): Promise<MyUploadsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const type = query.type ?? 'all';
    const offset = (page - 1) * limit;
    const search = query.search?.trim();
    const contains = search
      ? { contains: escapeRegex(search), mode: Prisma.QueryMode.insensitive }
      : undefined;

    const composerWhere: Prisma.ComposerWhereInput = {
      createdBy: userId,
      ...(contains && { OR: [{ name: contains }, { fullName: contains }] }),
      ...(query.epochId && { epochId: query.epochId }),
    };
    const [workWhere, scoreWhere] = await Promise.all([
      this.myWorksWhere(userId, query, contains),
      this.myScoresWhere(userId, query, contains),
    ]);

    const wants = (kind: MyUploadKind) => type === 'all' || type === kind;
    const window = (kind: MyUploadKind) => ({
      take:
        type === kind
          ? limit
          : query.limitPerType
            ? MY_UPLOADS_PER_TYPE
            : undefined,
      skip: type === kind ? offset : undefined,
      orderBy: { createdAt: Prisma.SortOrder.desc },
    });

    const [composers, works, scores, composerCount, workCount, scoreCount] =
      await Promise.all([
        wants('composer')
          ? this.prisma.composer.findMany({
              where: composerWhere,
              select: MY_COMPOSER_SELECT,
              ...window('composer'),
            })
          : Promise.resolve([]),
        wants('work')
          ? this.prisma.work.findMany({
              where: workWhere,
              select: MY_WORK_SELECT,
              ...window('work'),
            })
          : Promise.resolve([]),
        wants('score')
          ? this.prisma.workScore.findMany({
              where: scoreWhere,
              select: MY_SCORE_SELECT,
              ...window('score'),
            })
          : Promise.resolve([]),
        this.prisma.composer.count({ where: composerWhere }),
        this.prisma.work.count({ where: workWhere }),
        this.prisma.workScore.count({ where: scoreWhere }),
      ]);

    const items: MyUploadItemDto[] = [
      ...composers.map((composer) => ({
        id: composer.id,
        title: composer.fullName || composer.name,
        type: 'composer' as const,
        createdAt: composer.createdAt.toISOString(),
        updatedAt: composer.updatedAt.toISOString(),
        isIMSLP: !!composer.imslpId,
        imslpId: composer.imslpId ?? undefined,
        epochName: composer.epoch?.name,
        dataQuality: composer.dataQuality ?? undefined,
        verificationStatus: composer.verificationStatus ?? undefined,
        portraitUrl: composer.portraitUrl ?? undefined,
      })),
      ...works.map((work) => ({
        id: work.id,
        title: work.title,
        type: 'work' as const,
        createdAt: work.createdAt.toISOString(),
        updatedAt: work.updatedAt.toISOString(),
        isIMSLP: !!work.imslpId,
        imslpId: work.imslpId ?? undefined,
        imslpPermlink: work.imslpPermlink ?? undefined,
        epochName: work.epoch?.name,
        composerName: work.composer.fullName || work.composer.name,
        composerId: work.composer.id,
        instrumentName: work.instrument?.name,
        workGenres: work.workGenresArr,
        categoryNames: work.categoryNames,
      })),
      ...scores.map((score) => ({
        id: score.id,
        title: score.title,
        type: 'score' as const,
        createdAt: score.createdAt.toISOString(),
        updatedAt: score.updatedAt.toISOString(),
        isIMSLP: score.source === ScoreSource.IMSLP,
        composerName: score.work.composer.fullName || score.work.composer.name,
        composerId: score.work.composer.id,
        workTitle: score.work.title,
        workId: score.work.id,
        fileSize: score.fileSize ?? undefined,
        pageCount: score.pageCount ?? undefined,
        downloadUrl: score.downloadUrl ?? undefined,
        dataQuality: score.dataQuality ?? undefined,
        verificationStatus: score.verificationStatus ?? undefined,
      })),
    ];

    if (type === 'all') {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    return {
      items:
        type === 'all' && !query.limitPerType
          ? items.slice(offset, offset + limit)
          : items,
      totalCount: composerCount + workCount + scoreCount,
      composerCount,
      workCount,
      scoreCount,
      hasMoreComposers: composerCount > MY_UPLOADS_PER_TYPE,
      hasMoreWorks: workCount > MY_UPLOADS_PER_TYPE,
      hasMoreScores: scoreCount > MY_UPLOADS_PER_TYPE,
    };
  }

  /** Obras da pessoa; a busca casa o título ou o compositor, pelos ids. */
  private async myWorksWhere(
    userId: string,
    query: ListMyUploadsQueryDto,
    contains?: MyUploadsContains,
  ): Promise<Prisma.WorkWhereInput> {
    const conditions: Prisma.WorkWhereInput[] = [{ createdBy: userId }];
    if (query.epochId) conditions.push({ epochId: query.epochId });
    if (query.composerId) conditions.push({ composerId: query.composerId });

    if (contains) {
      const ownComposerIds = (
        await this.prisma.work.findMany({
          where: { createdBy: userId },
          select: { composerId: true },
          distinct: ['composerId'],
        })
      ).map((work) => work.composerId);
      const matchingComposerIds = ownComposerIds.length
        ? (
            await this.prisma.composer.findMany({
              where: {
                id: { in: ownComposerIds },
                OR: [{ name: contains }, { fullName: contains }],
              },
              select: { id: true },
            })
          ).map((composer) => composer.id)
        : [];

      conditions.push({
        OR: [
          { title: contains },
          ...(matchingComposerIds.length
            ? [{ composerId: { in: matchingComposerIds } }]
            : []),
        ],
      });
    }

    return { AND: conditions };
  }

  /** Partituras enviadas pela pessoa (não as do IMSLP); época e busca pela obra, pelos ids. */
  private async myScoresWhere(
    userId: string,
    query: ListMyUploadsQueryDto,
    contains?: MyUploadsContains,
  ): Promise<Prisma.WorkScoreWhereInput> {
    const own: Prisma.WorkScoreWhereInput = {
      uploadedBy: userId,
      source: { in: [ScoreSource.CUSTOM, ScoreSource.UPLOAD] },
    };
    const conditions: Prisma.WorkScoreWhereInput[] = [own];
    if (query.workId) conditions.push({ workId: query.workId });

    if (query.epochId || contains) {
      const ownWorkIds = (
        await this.prisma.workScore.findMany({
          where: own,
          select: { workId: true },
          distinct: ['workId'],
        })
      ).map((score) => score.workId);
      const worksWhere = async (where: Prisma.WorkWhereInput) =>
        ownWorkIds.length
          ? (
              await this.prisma.work.findMany({
                where: { id: { in: ownWorkIds }, ...where },
                select: { id: true },
              })
            ).map((work) => work.id)
          : [];

      if (query.epochId) {
        conditions.push({
          workId: { in: await worksWhere({ epochId: query.epochId }) },
        });
      }

      if (contains) {
        const byWorkTitle = await worksWhere({ title: contains });
        conditions.push({
          OR: [
            { title: contains },
            ...(byWorkTitle.length ? [{ workId: { in: byWorkTitle } }] : []),
          ],
        });
      }
    }

    return { AND: conditions };
  }
}
