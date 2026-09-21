import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import { toCsv } from '../../common/utils/csv.util';
import {
  AuditSummaryQueryDto,
  ListAuditQueryDto,
} from './dto/admin-operations.dto';

const MAX_EXPORT_ROWS = 20_000;

const DAY_MS = 24 * 60 * 60 * 1000;

const AUDIT_SELECT = {
  id: true,
  actorId: true,
  actorRole: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  requestId: true,
  success: true,
  createdAt: true,
} as const;

type AuditRow = Prisma.AdminAuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consulta a trilha de auditoria administrativa.
   *
   * **Esta superfície de leitura não existia.** O `@Audited()` grava em
   * `AdminAuditLog` desde a primeira fatia do Admin, e até aqui não havia
   * nenhuma rota para consultar o que foi gravado — uma trilha que ninguém
   * consegue ler não serve à investigação para a qual foi criada.
   *
   * O nome de quem agiu é resolvido em lote, uma consulta para a página
   * inteira.
   */
  async list(query: ListAuditQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where = this.buildWhere(query);

    const paging = pageArgs({ cursor: query.cursor, page, limit });

    const entries = await this.prisma.adminAuditLog.findMany({
      where,
      select: AUDIT_SELECT,
      // O id desempata: sem ele, dois registros do mesmo instante trocam de
      // lugar entre uma busca e outra, e o cursor pula ou repete um deles.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: paging.take,
      skip: paging.skip,
      cursor: paging.cursor,
    });

    const total = query.cursor
      ? null
      : await this.prisma.adminAuditLog.count({ where });

    return {
      entries: await this.withActors(entries),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === null ? null : Math.ceil(total / limit),
        nextCursor: nextCursorOf(entries, limit),
      },
    };
  }

  /**
   * Resumo do período: o que mais aconteceu, quem mais agiu, o que falhou.
   *
   * As tentativas negadas ficam em destaque porque são o que uma investigação
   * procura primeiro — o `@Audited()` registra tanto o sucesso quanto a recusa.
   */
  async summary(query: AuditSummaryQueryDto) {
    const days = query.days ?? 30;
    const since = new Date(Date.now() - days * DAY_MS);
    const where: Prisma.AdminAuditLogWhereInput = { createdAt: { gte: since } };

    const [total, falhas, porAcao, porAtor] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.count({ where: { ...where, success: false } }),
      this.prisma.adminAuditLog.groupBy({
        by: ['action'],
        where,
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 20,
      }),
      this.prisma.adminAuditLog.groupBy({
        by: ['actorId'],
        where,
        _count: { _all: true },
        orderBy: { _count: { actorId: 'desc' } },
        take: 10,
      }),
    ]);

    const actorIds = porAtor
      .map((row) => row.actorId)
      .filter((id): id is string => id !== null);

    const atores = await this.loadActors(actorIds);

    return {
      period: { days, since },
      total,
      failures: falhas,
      // `null` sem base: nenhuma ação registrada não é 0% de falha.
      failureRate: total > 0 ? Math.round((falhas / total) * 1000) / 10 : null,
      byAction: porAcao.map((row) => ({
        action: row.action,
        count: row._count._all,
      })),
      topActors: porAtor.map((row) => ({
        actorId: row.actorId,
        name: row.actorId ? (atores.get(row.actorId) ?? null) : null,
        count: row._count._all,
      })),
    };
  }

  async export(query: ListAuditQueryDto) {
    const entries = await this.prisma.adminAuditLog.findMany({
      where: this.buildWhere(query),
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_ROWS,
    });

    const rows = await this.withActors(entries);

    if (query.format !== 'csv') {
      return {
        entries: rows,
        count: rows.length,
        truncated: rows.length >= MAX_EXPORT_ROWS,
        exportedAt: new Date(),
      };
    }

    const csv = toCsv(
      [
        'Quando',
        'Ação',
        'Sucesso',
        'Quem',
        'Papel',
        'Entidade',
        'Id da entidade',
        'IP',
        'Requisição',
      ],
      rows.map((entry) => [
        entry.createdAt,
        entry.action,
        entry.success ? 'sim' : 'não',
        entry.actorName ?? entry.actorId,
        entry.actorRole,
        entry.entityType,
        entry.entityId,
        entry.ipAddress,
        entry.requestId,
      ]),
    );

    return { csv, count: rows.length };
  }

  // -------------------------------------------------------------------

  private async withActors(entries: AuditRow[]) {
    const ids = entries
      .map((entry) => entry.actorId)
      .filter((id): id is string => id !== null);

    const atores = await this.loadActors(ids);

    return entries.map((entry) => ({
      ...entry,
      actorName: entry.actorId ? (atores.get(entry.actorId) ?? null) : null,
    }));
  }

  /**
   * Nome de quem agiu.
   *
   * A trilha guarda só o id, de propósito: ela precisa continuar legível mesmo
   * que a conta seja removida depois. Quando o usuário não existe mais, o nome
   * vem nulo e o id permanece — o registro não se perde.
   */
  private async loadActors(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) {
      return new Map();
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    return new Map(
      users.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          user.email ||
          user.id,
      ]),
    );
  }

  private buildWhere(query: ListAuditQueryDto): Prisma.AdminAuditLogWhereInput {
    return {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actionPrefix
        ? { action: { startsWith: escapeRegex(query.actionPrefix) } }
        : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.onlyFailures ? { success: false } : {}),
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
