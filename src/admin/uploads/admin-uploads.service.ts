import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import {
  ListUploadHistoryQueryDto,
  UploadStatsQueryDto,
} from './dto/admin-uploads.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const TOP_CONTRIBUTORS = 10;

/**
 * Teto de registros lidos para montar a linha do tempo.
 *
 * A janela é de no máximo 90 dias e a projeção tem dois campos, mas o teto
 * existe para o custo não depender do volume de uma instalação grande.
 */
const MAX_TIMELINE_ROWS = 50_000;

const HISTORY_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  reason: true,
  changes: true,
  createdAt: true,
  user: {
    select: { id: true, firstName: true, lastName: true, image: true },
  },
} as const;

type HistoryRow = Prisma.UploadHistoryGetPayload<{
  select: typeof HISTORY_SELECT;
}>;

@Injectable()
export class AdminUploadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Histórico de contribuições ao catálogo.
   *
   * As entidades citadas são resolvidas **em lote, uma consulta por tipo**. O
   * legado resolvia dentro de um `map`, então uma página de 50 linhas disparava
   * até 50 consultas adicionais — sexta aparição desse padrão na migração.
   */
  async list(query: ListUploadHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = this.buildWhere(query);

    const paging = pageArgs({ cursor: query.cursor, page, limit });

    const entries = await this.prisma.uploadHistory.findMany({
      where,
      select: HISTORY_SELECT,
      // O id desempata: sem ele, dois registros do mesmo instante trocam de
      // lugar entre uma busca e outra, e o cursor pula ou repete um deles.
      orderBy: [
        { createdAt: query.sortOrder ?? 'desc' },
        { id: query.sortOrder ?? 'desc' },
      ],
      take: paging.take,
      skip: paging.skip,
      cursor: paging.cursor,
    });

    const total = query.cursor
      ? null
      : await this.prisma.uploadHistory.count({ where });

    return {
      entries: await this.enrich(entries),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === null ? null : Math.ceil(total / limit),
        nextCursor: nextCursorOf(entries, limit),
      },
    };
  }

  private async enrich(entries: HistoryRow[]) {
    const idsByType = new Map<string, Set<string>>();

    for (const entry of entries) {
      const bucket = idsByType.get(entry.entityType) ?? new Set<string>();
      bucket.add(entry.entityId);
      idsByType.set(entry.entityType, bucket);
    }

    const [composers, works, scores] = await Promise.all([
      this.loadMap(idsByType.get('composer'), (ids) =>
        this.prisma.composer.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, isVerified: true },
        }),
      ),
      this.loadMap(idsByType.get('work'), (ids) =>
        this.prisma.work.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            title: true,
            isVerified: true,
            composer: { select: { id: true, name: true } },
          },
        }),
      ),
      this.loadMap(idsByType.get('score'), (ids) =>
        this.prisma.workScore.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            title: true,
            isActive: true,
            work: { select: { id: true, title: true } },
          },
        }),
      ),
    ]);

    return entries.map((entry) => {
      const entity =
        composers.get(entry.entityId) ??
        works.get(entry.entityId) ??
        scores.get(entry.entityId) ??
        null;

      return {
        ...entry,
        entity,
        // Contribuição sobre entidade já removida continua no histórico: é o
        // registro de que a remoção aconteceu.
        entityExists: entity !== null,
      };
    });
  }

  private async loadMap<T extends { id: string }>(
    ids: Set<string> | undefined,
    load: (ids: string[]) => Promise<T[]>,
  ): Promise<Map<string, T>> {
    if (!ids || ids.size === 0) {
      return new Map();
    }

    return new Map((await load([...ids])).map((row) => [row.id, row]));
  }

  // -------------------------------------------------------------------

  /**
   * Números e linha do tempo das contribuições.
   *
   * **A linha do tempo saía errada e cara.** O legado montava 14 baldes com
   * `new Date(Date.now() - i * 24h)` e disparava **três contagens por balde**:
   * 42 consultas para desenhar um gráfico. Pior, os limites usavam a hora
   * corrente em vez da meia-noite, então o balde `i = 0` cobria
   * `[agora, agora + 24h)` — uma janela **no futuro**, que dava zero sempre. O
   * dia de hoje aparecia vazio no gráfico, todos os dias, e os demais ficavam
   * deslocados em relação ao rótulo.
   *
   * Aqui é uma consulta só, sobre a janela inteira, com os baldes montados a
   * partir da meia-noite local.
   */
  async stats(query: UploadStatsQueryDto) {
    const days = query.days ?? 14;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const [total, byAction, byEntityType, rows] = await Promise.all([
      this.prisma.uploadHistory.count(),
      this.prisma.uploadHistory.groupBy({
        by: ['action'],
        _count: { _all: true },
      }),
      this.prisma.uploadHistory.groupBy({
        by: ['entityType'],
        _count: { _all: true },
      }),
      this.prisma.uploadHistory.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, action: true },
        take: MAX_TIMELINE_ROWS,
      }),
    ]);

    return {
      total,
      byAction: Object.fromEntries(
        byAction.map((row) => [row.action, row._count._all]),
      ),
      byEntityType: Object.fromEntries(
        byEntityType.map((row) => [row.entityType, row._count._all]),
      ),
      timeline: this.buildTimeline(start, days, rows),
    };
  }

  private buildTimeline(
    start: Date,
    days: number,
    rows: Array<{ createdAt: Date; action: string }>,
  ) {
    const buckets = Array.from({ length: days }, (_, offset) => {
      const date = new Date(start.getTime() + offset * DAY_MS);

      return {
        date,
        total: 0,
        creates: 0,
        updates: 0,
        deletes: 0,
      };
    });

    for (const row of rows) {
      const index = Math.floor(
        (row.createdAt.getTime() - start.getTime()) / DAY_MS,
      );

      if (index < 0 || index >= buckets.length) {
        continue;
      }

      const bucket = buckets[index];
      bucket.total += 1;

      if (row.action === 'create') {
        bucket.creates += 1;
      } else if (row.action === 'update') {
        bucket.updates += 1;
      } else if (row.action === 'delete') {
        bucket.deletes += 1;
      }
    }

    return buckets;
  }

  /**
   * Quem mais contribuiu.
   *
   * Duas consultas: o agrupamento e a busca dos usuários envolvidos. O legado
   * já fazia assim para os contribuidores — é o resto da rota que resolvia
   * linha a linha.
   */
  async topContributors() {
    const rows = await this.prisma.uploadHistory.groupBy({
      by: ['userId'],
      _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } },
      take: TOP_CONTRIBUTORS,
    });

    if (rows.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, firstName: true, lastName: true, image: true },
    });

    const byId = new Map(users.map((user) => [user.id, user]));

    return rows.map((row) => {
      const user = byId.get(row.userId);

      return {
        userId: row.userId,
        name: user
          ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
          : null,
        image: user?.image ?? null,
        contributions: row._count._all,
      };
    });
  }

  private buildWhere(
    query: ListUploadHistoryQueryDto,
  ): Prisma.UploadHistoryWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(search
        ? { reason: { contains: escapeRegex(search), mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }
}
