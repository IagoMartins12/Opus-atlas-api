import { escapeRegex } from '../../common/utils/regex.util';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  runAggregate,
  toObjectId,
  topPorContagem,
} from '../metrics/raw-aggregate';
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
    const agora = new Date();
    const fim = query.to ? new Date(query.to) : agora;
    let inicio: Date | null = null;
    if (query.from) {
      inicio = new Date(query.from);
    } else if (query.days) {
      inicio = new Date(agora);
      inicio.setHours(0, 0, 0, 0);
      inicio.setDate(inicio.getDate() - (query.days - 1));
    }

    const where: Prisma.UploadHistoryWhereInput = {
      createdAt: { ...(inicio ? { gte: inicio } : {}), lte: fim },
    };

    const [
      total,
      byAction,
      byEntityType,
      porPessoa,
      rows,
      maisEditados,
      primeiraVez,
      totalGeral,
    ] = await Promise.all([
      this.prisma.uploadHistory.count({ where }),
      this.prisma.uploadHistory.groupBy({
        by: ['action'],
        where,
        _count: { _all: true },
      }),
      this.prisma.uploadHistory.groupBy({
        by: ['entityType'],
        where,
        _count: { _all: true },
      }),
      this.prisma.uploadHistory.groupBy({
        by: ['userId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.uploadHistory.findMany({
        where,
        select: { createdAt: true, action: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_TIMELINE_ROWS,
      }),
      // Contado e cortado no banco: o `groupBy` do Prisma com `orderBy` por
      // contagem e `take` devolve grupos quaisquer no MongoDB.
      runAggregate<{ _id: { t: string; i: unknown }; n: number }>(
        this.prisma,
        'upload_history',
        [
          {
            $match: {
              action: 'update',
              createdAt: {
                ...(inicio ? { $gte: { $date: inicio.toISOString() } } : {}),
                $lte: { $date: fim.toISOString() },
              },
            },
          },
          {
            $group: {
              _id: { t: '$entityType', i: '$entityId' },
              n: { $sum: 1 },
            },
          },
          { $sort: { n: -1 } },
          { $limit: 5 },
        ],
      ).then((linhas) =>
        linhas.map((l) => ({
          entityType: l._id.t,
          entityId: toObjectId(l._id.i) ?? String(l._id.i),
          _count: { _all: l.n },
        })),
      ),
      // Contribuintes cuja primeira contribuição caiu dentro da janela.
      inicio
        ? this.prisma.uploadHistory.groupBy({
            by: ['userId'],
            _min: { createdAt: true },
            having: { createdAt: { _min: { gte: inicio } } },
          })
        : Promise.resolve(null),
      this.prisma.uploadHistory.count(),
    ]);

    // Os agrupamentos com `orderBy` por contagem não saem ordenados no Mongo.
    const ranking = [...porPessoa].sort(
      (x, y) => y._count._all - x._count._all,
    );
    const topo = ranking.slice(0, TOP_CONTRIBUTORS);
    const [pessoas, nomes] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: topo.map((r) => r.userId) } },
        select: { id: true, firstName: true, lastName: true, image: true },
      }),
      this.nomesDe(maisEditados),
    ]);
    const pessoa = new Map(pessoas.map((u) => [u.id, u]));

    const inicioDaLinha =
      inicio ?? rows[0]?.createdAt ?? new Date(agora.getTime() - 13 * DAY_MS);
    const dias = Math.max(
      1,
      Math.ceil((fim.getTime() - inicioDaLinha.getTime()) / DAY_MS),
    );
    const passo: 'dia' | 'semana' | 'mes' =
      dias <= 92 ? 'dia' : dias <= 400 ? 'semana' : 'mes';

    return {
      janela: { de: inicio, ate: fim, passo },
      total,
      totalGeral,
      byAction: Object.fromEntries(
        byAction.map((row) => [row.action, row._count._all]),
      ),
      byEntityType: Object.fromEntries(
        byEntityType.map((row) => [row.entityType, row._count._all]),
      ),
      contribuintes: porPessoa.length,
      contribuintesNovos: primeiraVez ? primeiraVez.length : null,
      mediaPorContribuinte:
        porPessoa.length > 0
          ? Math.round((total / porPessoa.length) * 10) / 10
          : null,
      topContribuintes: topo.map((r) => {
        const u = pessoa.get(r.userId);
        return {
          userId: r.userId,
          name: u
            ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
            : null,
          image: u?.image ?? null,
          contributions: r._count._all,
        };
      }),
      maisEditados: [...maisEditados]
        .sort((x, y) => y._count._all - x._count._all)
        .map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          nome: nomes.get(r.entityId) ?? null,
          edicoes: r._count._all,
        })),
      linhaDoTempoCortada: rows.length >= MAX_TIMELINE_ROWS,
      timeline: this.buildTimeline(inicioDaLinha, fim, passo, rows),
    };
  }

  /** Nome atual de cada registro citado (compositor, obra, partitura). */
  private async nomesDe(
    linhas: Array<{ entityType: string; entityId: string }>,
  ): Promise<Map<string, string>> {
    const ids = (tipo: string) =>
      linhas.filter((l) => l.entityType === tipo).map((l) => l.entityId);
    const [c, w, s] = await Promise.all([
      ids('composer').length
        ? this.prisma.composer.findMany({
            where: { id: { in: ids('composer') } },
            select: { id: true, name: true },
          })
        : [],
      ids('work').length
        ? this.prisma.work.findMany({
            where: { id: { in: ids('work') } },
            select: { id: true, title: true },
          })
        : [],
      ids('score').length
        ? this.prisma.workScore.findMany({
            where: { id: { in: ids('score') } },
            select: { id: true, title: true },
          })
        : [],
    ]);
    return new Map<string, string>([
      ...c.map((x) => [x.id, x.name] as [string, string]),
      ...w.map((x) => [x.id, x.title] as [string, string]),
      ...s.map((x) => [x.id, x.title] as [string, string]),
    ]);
  }

  private buildTimeline(
    inicio: Date,
    fim: Date,
    passo: 'dia' | 'semana' | 'mes',
    rows: Array<{ createdAt: Date; action: string }>,
  ) {
    // Baldes a partir da meia-noite local do primeiro dia.
    const base = new Date(inicio);
    base.setHours(0, 0, 0, 0);
    if (passo === 'mes') base.setDate(1);

    const proximo = (d: Date) => {
      const n = new Date(d);
      if (passo === 'dia') n.setDate(n.getDate() + 1);
      else if (passo === 'semana') n.setDate(n.getDate() + 7);
      else n.setMonth(n.getMonth() + 1);
      return n;
    };

    const buckets: Array<{
      date: Date;
      total: number;
      creates: number;
      updates: number;
      deletes: number;
    }> = [];
    for (let d = base; d <= fim && buckets.length < 400; d = proximo(d)) {
      buckets.push({ date: d, total: 0, creates: 0, updates: 0, deletes: 0 });
    }

    let i = 0;
    for (const row of rows) {
      while (i + 1 < buckets.length && row.createdAt >= buckets[i + 1].date) {
        i++;
      }
      const bucket = buckets[i];
      if (!bucket || row.createdAt < bucket.date) continue;
      bucket.total += 1;
      if (row.action === 'create') bucket.creates += 1;
      else if (row.action === 'update') bucket.updates += 1;
      else if (row.action === 'delete') bucket.deletes += 1;
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
    // Contado e cortado no banco (ver `topPorContagem`).
    const rows = (
      await topPorContagem(this.prisma, 'upload_history', 'userId', {
        limite: TOP_CONTRIBUTORS,
      })
    ).map((r) => ({ userId: r.id, _count: { _all: r.n } }));

    if (rows.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, firstName: true, lastName: true, image: true },
    });

    const byId = new Map(users.map((user) => [user.id, user]));

    // O `orderBy` por contagem do groupBy não sai ordenado no MongoDB.
    return [...rows]
      .sort((a, b) => b._count._all - a._count._all)
      .map((row) => {
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
