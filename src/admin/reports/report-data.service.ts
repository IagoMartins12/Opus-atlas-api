import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { runAggregate, toObjectId } from '../metrics/raw-aggregate';
import { ReportData, ReportType } from './report-types';

const USER_TYPE_LABELS: Record<string, string> = {
  MUSIC_STUDENT: 'Estudante de música',
  CASUAL_USER: 'Ouvinte',
  PROFESSIONAL: 'Profissional',
  TEACHER: 'Professor',
};

const CATEGORY_LABELS: Record<string, string> = {
  TECHNIQUE: 'Técnica',
  INTERPRETATION: 'Interpretação',
  THEORY: 'Teoria',
  PRACTICE_TIP: 'Dica de estudo',
  PERFORMANCE: 'Performance',
  HISTORICAL: 'Contexto histórico',
  GENERAL: 'Geral',
};

const NEW_USERS_LIMIT = 500;
const NEW_WORKS_LIMIT = 100;
const NEW_COMPOSERS_LIMIT = 50;
const TOP_LIMIT = 10;
const TOP_CONTRIBUTORS_LIMIT = 20;

const fullName = (user: {
  firstName: string | null;
  lastName: string | null;
}) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Usuário';

/**
 * Os números de cada relatório do painel.
 *
 * Os mesmos três do legado (usuários, conteúdo, engajamento), com três
 * correções:
 *
 * - **"Obras populares" eram as mais recentes.** O legado desistiu de ordenar
 *   por favoritos (`_count` travava) e ordenou por data, com o título de
 *   "populares". Aqui é por favoritos de fato, agrupado no banco.
 * - **Uma consulta por época, por obra e por compositor** — 60 consultas para
 *   montar três tabelas de dez linhas. Aqui são agrupamentos.
 * - **"Usuário ativo" era `updatedAt` no período**, que muda com qualquer
 *   escrita no cadastro. Aqui é `lastSeen`, o último acesso.
 */
@Injectable()
export class ReportDataService {
  constructor(private readonly prisma: PrismaService) {}

  build(type: ReportType, start: Date, end: Date): Promise<ReportData> {
    switch (type) {
      case 'users-overview':
        return this.users(start, end);
      case 'content-analysis':
        return this.content(start, end);
      case 'engagement-metrics':
        return this.engagement(start, end);
    }
  }

  private async users(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [
      total,
      newUsers,
      newUsersCount,
      active,
      byType,
      contributors,
      withInstruments,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        where: { createdAt: period },
        select: {
          firstName: true,
          lastName: true,
          createdAt: true,
          userType: true,
          experienceLevel: true,
        },
        orderBy: { createdAt: 'desc' },
        take: NEW_USERS_LIMIT,
      }),
      this.prisma.user.count({ where: { createdAt: period } }),
      this.prisma.user.count({ where: { lastSeen: period } }),
      // Cru: valor de enum fora da lista (dado antigo) derrubaria o groupBy.
      runAggregate<{ _id: unknown; count: number }>(this.prisma, 'User', [
        { $group: { _id: '$userType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.prisma.user.findMany({
        where: { totalUploads: { gt: 0 } },
        select: {
          firstName: true,
          lastName: true,
          totalUploads: true,
          uploadScore: true,
        },
        orderBy: { uploadScore: 'desc' },
        take: TOP_CONTRIBUTORS_LIMIT,
      }),
      this.prisma.user.count({ where: { instruments: { some: {} } } }),
    ]);

    return {
      summary: [
        ['Usuários', total],
        ['Novos no período', newUsersCount],
        ['Ativos no período', active],
        ['Com instrumento cadastrado', withInstruments],
      ],
      sections: [
        {
          title:
            newUsersCount > newUsers.length
              ? `Novos usuários (os ${newUsers.length} mais recentes de ${newUsersCount})`
              : 'Novos usuários',
          columns: ['Nome', 'Cadastro', 'Perfil', 'Nível'],
          rows: newUsers.map((user) => [
            fullName(user),
            user.createdAt.toISOString(),
            USER_TYPE_LABELS[user.userType ?? 'CASUAL_USER'] ?? user.userType,
            user.experienceLevel,
          ]),
        },
        {
          title: 'Usuários por perfil',
          columns: ['Perfil', 'Usuários'],
          rows: byType.map((group) => {
            const type = typeof group._id === 'string' ? group._id : null;
            return [
              type ? (USER_TYPE_LABELS[type] ?? type) : 'Não informado',
              group.count,
            ];
          }),
        },
        {
          title: 'Principais contribuidores',
          columns: ['Nome', 'Envios', 'Pontuação'],
          rows: contributors.map((user) => [
            fullName(user),
            user.totalUploads,
            user.uploadScore,
          ]),
        },
      ],
    };
  }

  private async content(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [
      works,
      composers,
      scores,
      newWorks,
      newWorksCount,
      newComposers,
      newComposersCount,
      instruments,
      userInstruments,
      topWorks,
      topComposers,
      epochs,
    ] = await Promise.all([
      this.prisma.work.count(),
      this.prisma.composer.count(),
      this.prisma.workScore.count({ where: { isActive: true } }),
      this.prisma.work.findMany({
        where: { createdAt: period },
        select: {
          title: true,
          createdAt: true,
          composer: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: NEW_WORKS_LIMIT,
      }),
      this.prisma.work.count({ where: { createdAt: period } }),
      this.prisma.composer.findMany({
        where: { createdAt: period },
        select: { name: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: NEW_COMPOSERS_LIMIT,
      }),
      this.prisma.composer.count({ where: { createdAt: period } }),
      this.prisma.instrument.count(),
      this.prisma.userInstrument.count(),
      this.topBy('FavoriteWork', 'workId'),
      this.topBy('FavoriteComposer', 'composerId'),
      this.epochTotals(),
    ]);

    const workIds = topWorks.map((top) => top.id);
    const composerIds = topComposers.map((top) => top.id);
    const [workRows, annotationCounts, composerRows, composerWorkCounts] =
      await Promise.all([
        this.prisma.work.findMany({
          where: { id: { in: workIds } },
          select: {
            id: true,
            title: true,
            composer: { select: { name: true } },
          },
        }),
        this.prisma.workAnnotation.groupBy({
          by: ['workId'],
          where: { workId: { in: workIds }, isPublic: true },
          _count: { _all: true },
        }),
        this.prisma.composer.findMany({
          where: { id: { in: composerIds } },
          select: { id: true, name: true, epoch: { select: { name: true } } },
        }),
        this.prisma.work.groupBy({
          by: ['composerId'],
          where: { composerId: { in: composerIds } },
          _count: { _all: true },
        }),
      ]);

    const workById = new Map(workRows.map((work) => [work.id, work]));
    const composerById = new Map(composerRows.map((c) => [c.id, c]));
    const annotationsOf = new Map(
      annotationCounts.map((row) => [row.workId, row._count._all]),
    );
    const worksOf = new Map(
      composerWorkCounts.map((row) => [row.composerId, row._count._all]),
    );

    return {
      summary: [
        ['Obras', works],
        ['Compositores', composers],
        ['Partituras ativas', scores],
        ['Obras novas no período', newWorksCount],
        ['Compositores novos no período', newComposersCount],
        ['Instrumentos', instruments],
        ['Vínculos usuário–instrumento', userInstruments],
      ],
      sections: [
        {
          title: 'Obras novas',
          columns: ['Título', 'Compositor', 'Cadastro'],
          rows: newWorks.map((work) => [
            work.title,
            work.composer?.name ?? null,
            work.createdAt.toISOString(),
          ]),
        },
        {
          title: 'Compositores novos',
          columns: ['Nome', 'Cadastro'],
          rows: newComposers.map((composer) => [
            composer.name,
            composer.createdAt.toISOString(),
          ]),
        },
        {
          title: 'Obras mais favoritadas',
          columns: ['Título', 'Compositor', 'Favoritos', 'Anotações públicas'],
          rows: topWorks
            .filter((top) => workById.has(top.id))
            .map((top) => {
              const work = workById.get(top.id)!;
              return [
                work.title,
                work.composer?.name ?? null,
                top.count,
                annotationsOf.get(top.id) ?? 0,
              ];
            }),
        },
        {
          title: 'Compositores mais favoritados',
          columns: ['Nome', 'Época', 'Obras', 'Favoritos'],
          rows: topComposers
            .filter((top) => composerById.has(top.id))
            .map((top) => {
              const composer = composerById.get(top.id)!;
              return [
                composer.name,
                composer.epoch?.name ?? null,
                worksOf.get(top.id) ?? 0,
                top.count,
              ];
            }),
        },
        {
          title: 'Épocas',
          columns: ['Época', 'Compositores', 'Obras'],
          rows: epochs.map((epoch) => [
            epoch.name,
            epoch.composers,
            epoch.works,
          ]),
        },
      ],
    };
  }

  private async engagement(start: Date, end: Date): Promise<ReportData> {
    const period = { gte: start, lte: end };
    const [annotations, active, byCategory] = await Promise.all([
      this.prisma.workAnnotation.count({
        where: { createdAt: period, isPublic: true },
      }),
      this.prisma.user.count({ where: { lastSeen: period } }),
      runAggregate<{ _id: unknown; count: number }>(
        this.prisma,
        'work_annotations',
        [
          {
            $match: {
              isPublic: true,
              createdAt: {
                $gte: { $date: start.toISOString() },
                $lte: { $date: end.toISOString() },
              },
            },
          },
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
      ),
    ]);

    return {
      summary: [
        ['Anotações públicas no período', annotations],
        ['Usuários ativos no período', active],
      ],
      sections: [
        {
          title: 'Anotações por categoria',
          columns: ['Categoria', 'Anotações'],
          rows: byCategory.map((group) => {
            const category = typeof group._id === 'string' ? group._id : null;
            return [
              category
                ? (CATEGORY_LABELS[category] ?? category)
                : 'Sem categoria',
              group.count,
            ];
          }),
        },
      ],
    };
  }

  /** Os mais favoritados de uma coleção de favoritos, agrupados no banco. */
  private async topBy(
    collection: 'FavoriteWork' | 'FavoriteComposer',
    field: 'workId' | 'composerId',
  ): Promise<Array<{ id: string; count: number }>> {
    const rows = await runAggregate<{ _id: unknown; count: number }>(
      this.prisma,
      collection,
      [
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: TOP_LIMIT },
      ],
    );

    return rows.flatMap((row) => {
      const id = toObjectId(row._id);
      return id ? [{ id, count: row.count }] : [];
    });
  }

  private async epochTotals() {
    const [epochs, composers, works] = await Promise.all([
      this.prisma.epoch.findMany({ select: { id: true, name: true } }),
      this.prisma.composer.groupBy({ by: ['epochId'], _count: { _all: true } }),
      this.prisma.work.groupBy({ by: ['epochId'], _count: { _all: true } }),
    ]);

    const composersOf = new Map(
      composers.map((row) => [row.epochId, row._count._all]),
    );
    const worksOf = new Map(works.map((row) => [row.epochId, row._count._all]));

    return epochs
      .map((epoch) => ({
        name: epoch.name,
        composers: composersOf.get(epoch.id) ?? 0,
        works: worksOf.get(epoch.id) ?? 0,
      }))
      .sort((a, b) => b.works + b.composers - (a.works + a.composers));
  }
}
