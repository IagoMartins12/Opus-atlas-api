import { escapeRegex } from '../../common/utils/regex.util';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  runAggregate,
  toObjectId,
  topPorContagem,
} from '../metrics/raw-aggregate';
import { PrismaService } from '../../prisma/prisma.service';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import { toCsv } from '../../common/utils/csv.util';
import {
  AuditSummaryQueryDto,
  ListAuditQueryDto,
  PurgeAuditDto,
} from './dto/admin-operations.dto';
import { AuditService } from '../../common/audit/audit.service';

/** A ação que registra uma limpeza. Ela mesma nunca é apagada. */
export const ACAO_LIMPEZA_DA_AUDITORIA = 'audit.purge';

const MAX_EXPORT_ROWS = 20_000;

/** Teto de registros achados por alvo ou campo (vira um `IN`). */
const MAX_JSON_MATCHES = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

function metadataField(metadata: Prisma.JsonValue, campo: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const valor = (metadata as Record<string, unknown>)[campo];
  return typeof valor === 'string' ? valor : null;
}

/** "campo: antes → depois; …", para a planilha ler numa célula. */
function describeChanges(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const mudancas = (metadata as { mudancas?: unknown }).mudancas;
  if (!Array.isArray(mudancas)) return null;
  return mudancas
    .map(
      (m: { campo?: string; antes?: unknown; depois?: unknown }) =>
        `${m.campo}: ${JSON.stringify(m.antes ?? null)} → ${JSON.stringify(m.depois ?? null)}`,
    )
    .join('; ');
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {}

  /**
   * Apaga registros da trilha — os escolhidos ou os que casam com os filtros.
   *
   * **Toda limpeza deixa rastro que não se apaga.** Um registro
   * `audit.purge` diz quem apagou, quantos e com que critério, e nenhuma
   * limpeza o alcança. Sem isso, apagar a auditoria seria o jeito de apagar
   * o que se fez.
   */
  async purge(dto: PurgeAuditDto, actorId: string) {
    const porId = !!dto.ids?.length;
    const temFiltro =
      !!dto.filtros &&
      Object.entries(dto.filtros).some(
        ([chave, valor]) =>
          !['cursor', 'page', 'limit'].includes(chave) &&
          valor !== undefined &&
          valor !== '' &&
          valor !== false,
      );

    if (!porId && !temFiltro) {
      throw new BadRequestException(
        'Escolha os registros ou use ao menos um filtro para apagar.',
      );
    }

    const criterio: Prisma.AdminAuditLogWhereInput = porId
      ? { id: { in: dto.ids } }
      : await this.buildWhere(dto.filtros!);

    const { count } = await this.prisma.adminAuditLog.deleteMany({
      where: {
        AND: [criterio, { action: { not: ACAO_LIMPEZA_DA_AUDITORIA } }],
      },
    });

    await this.auditoria.record({
      actorId,
      action: ACAO_LIMPEZA_DA_AUDITORIA,
      entityType: 'audit',
      success: true,
      metadata: {
        alvo: `${count} registros`,
        apagados: count,
        criterio: porId
          ? { ids: dto.ids!.length }
          : (JSON.parse(JSON.stringify(dto.filtros)) as Prisma.InputJsonValue),
      },
    });

    return { apagados: count };
  }

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
    const where = await this.buildWhere(query);

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
      // Contados e cortados no banco (ver `topPorContagem`).
      topPorContagem(this.prisma, 'admin_audit_logs', 'action', {
        limite: 20,
        match: { createdAt: { $gte: { $date: since.toISOString() } } },
      }).then((l) => l.map((r) => ({ action: r.id, _count: { _all: r.n } }))),
      runAggregate<{ _id: unknown; n: number }>(
        this.prisma,
        'admin_audit_logs',
        [
          { $match: { createdAt: { $gte: { $date: since.toISOString() } } } },
          { $group: { _id: '$actorId', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 10 },
        ],
      ).then((l) =>
        l.map((r) => ({
          actorId: r._id === null ? null : (toObjectId(r._id) ?? String(r._id)),
          _count: { _all: r.n },
        })),
      ),
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

  /**
   * O que existe para filtrar: todas as ações, tipos e pessoas que já
   * aparecem na trilha, com a contagem de cada um.
   *
   * A tela monta os filtros daqui em vez de uma lista escrita à mão — ação
   * nova no código aparece no filtro no mesmo dia, sem ninguém lembrar.
   */
  async facets() {
    const [acoes, tipos, atores] = await Promise.all([
      this.prisma.adminAuditLog.groupBy({
        by: ['action'],
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      this.prisma.adminAuditLog.groupBy({
        by: ['entityType'],
        _count: { _all: true },
        orderBy: { _count: { entityType: 'desc' } },
      }),
      runAggregate<{ _id: unknown; n: number }>(
        this.prisma,
        'admin_audit_logs',
        [
          { $group: { _id: '$actorId', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 100 },
        ],
      ).then((l) =>
        l.map((r) => ({
          actorId: r._id === null ? null : (toObjectId(r._id) ?? String(r._id)),
          _count: { _all: r.n },
        })),
      ),
    ]);
    // O `orderBy` por contagem do groupBy não ordena no MongoDB.
    acoes.sort((x, y) => y._count._all - x._count._all);
    tipos.sort((x, y) => y._count._all - x._count._all);

    const nomes = await this.loadActors(
      atores.map((row) => row.actorId).filter((id): id is string => !!id),
    );

    return {
      actions: acoes.map((row) => ({
        action: row.action,
        count: row._count._all,
      })),
      entityTypes: tipos
        .filter((row) => row.entityType)
        .map((row) => ({ entityType: row.entityType, count: row._count._all })),
      actors: atores.map((row) => ({
        actorId: row.actorId,
        name: row.actorId ? (nomes.get(row.actorId) ?? null) : null,
        count: row._count._all,
      })),
    };
  }

  async export(query: ListAuditQueryDto) {
    const entries = await this.prisma.adminAuditLog.findMany({
      where: await this.buildWhere(query),
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
        'Alvo',
        'Mudanças',
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
        metadataField(entry.metadata, 'alvo'),
        describeChanges(entry.metadata),
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

  private async buildWhere(
    query: ListAuditQueryDto,
  ): Promise<Prisma.AdminAuditLogWhereInput> {
    const and: Prisma.AdminAuditLogWhereInput[] = [];

    if (query.verb === 'create') {
      and.push({ action: { endsWith: '.create' } });
    } else if (query.verb === 'delete') {
      and.push({
        OR: [
          { action: { endsWith: '.delete' } },
          { action: { contains: '.delete' } },
          { action: { endsWith: '.clear' } },
        ],
      });
    } else if (query.verb === 'update') {
      and.push({
        OR: [
          { action: { endsWith: '.update' } },
          { action: { contains: '.verify' } },
          { action: { contains: 'Bulk' } },
          { action: { endsWith: '.set' } },
        ],
      });
    } else if (query.verb === 'other') {
      and.push({
        NOT: [
          { action: { endsWith: '.create' } },
          { action: { endsWith: '.update' } },
          { action: { endsWith: '.delete' } },
        ],
      });
    }

    if (query.ip?.trim()) {
      and.push({ ipAddress: { contains: escapeRegex(query.ip.trim()) } });
    }

    // Alvo e campo moram no `metadata` (JSON), que o Prisma não filtra no
    // Mongo: os ids saem de uma consulta crua, com teto.
    if (query.target?.trim() || query.field?.trim()) {
      const filtro: Record<string, unknown> = {};
      if (query.target?.trim()) {
        filtro['metadata.alvo'] = {
          $regex: escapeRegex(query.target.trim()),
          $options: 'i',
        };
      }
      if (query.field?.trim()) {
        filtro['metadata.mudancas.campo'] = query.field.trim();
      }
      const linhas = await runAggregate<{ _id: unknown }>(
        this.prisma,
        'admin_audit_logs',
        [
          { $match: filtro },
          { $sort: { createdAt: -1 } },
          { $limit: MAX_JSON_MATCHES },
          { $project: { _id: 1 } },
        ],
      );
      and.push({
        id: {
          in: linhas
            .map((l) => toObjectId(l._id))
            .filter((x): x is string => !!x),
        },
      });
    }

    return {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actionPrefix
        ? { action: { startsWith: escapeRegex(query.actionPrefix) } }
        : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.actorRole !== undefined
        ? { actorRole: String(query.actorRole) }
        : {}),
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
      ...(and.length ? { AND: and } : {}),
    };
  }
}
