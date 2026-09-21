import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TOP_LIMIT = 10;

@Injectable()
export class AdminCatalogMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Panorama do catálogo.
   *
   * Três correções sobre `admin/content`:
   *
   * 1. **Sem cache de processo.** O legado usava `unstable_cache` do Next, que
   *    é por instância e não sobrevive à escala horizontal — a terceira
   *    aparição desse mesmo cache na migração.
   * 2. **Partituras por época saem de uma agregação**, não de uma contagem por
   *    época dentro de um laço.
   * 3. **A lista de envios recentes resolve as entidades em lote**, não uma
   *    consulta por linha.
   */
  async overview() {
    const [
      composers,
      verifiedComposers,
      works,
      verifiedWorks,
      activeScores,
      scoresByType,
      composersByQuality,
    ] = await Promise.all([
      this.prisma.composer.count(),
      this.prisma.composer.count({ where: { isVerified: true } }),
      this.prisma.work.count(),
      this.prisma.work.count({ where: { isVerified: true } }),
      this.prisma.workScore.count({ where: { isActive: true } }),
      this.prisma.workScore.groupBy({
        by: ['type'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.prisma.composer.groupBy({
        by: ['dataQuality'],
        _count: { _all: true },
      }),
    ]);

    return {
      totals: {
        composers,
        verifiedComposers,
        works,
        verifiedWorks,
        activeScores,
      },
      coverage: {
        // `null` quando não há base: uma cobertura de 0% e "não há o que
        // cobrir" são coisas diferentes.
        composersVerifiedRate:
          composers > 0
            ? Math.round((verifiedComposers / composers) * 1000) / 10
            : null,
        worksVerifiedRate:
          works > 0 ? Math.round((verifiedWorks / works) * 1000) / 10 : null,
      },
      scoresByType: Object.fromEntries(
        scoresByType.map((row) => [row.type, row._count._all]),
      ),
      composersByDataQuality: Object.fromEntries(
        composersByQuality.map((row) => [
          row.dataQuality ?? 'UNSET',
          row._count._all,
        ]),
      ),
    };
  }

  /** Obras com mais anotações — usa o contador já mantido em `Work`. */
  async mostAnnotatedWorks() {
    return this.prisma.work.findMany({
      where: { annotationsCount: { gt: 0 } },
      select: {
        id: true,
        title: true,
        annotationsCount: true,
        composer: { select: { id: true, name: true } },
      },
      orderBy: { annotationsCount: 'desc' },
      take: TOP_LIMIT,
    });
  }

  /**
   * Distribuição de obras e partituras por época.
   *
   * Duas agregações, em vez de uma contagem por época dentro de um laço.
   */
  async byEpoch() {
    const [epochs, worksByEpoch] = await Promise.all([
      this.prisma.epoch.findMany({ select: { id: true, name: true } }),
      this.prisma.work.groupBy({
        by: ['epochId'],
        _count: { _all: true },
      }),
    ]);

    const worksMap = new Map(
      worksByEpoch
        .filter((row): row is typeof row & { epochId: string } =>
          Boolean(row.epochId),
        )
        .map((row) => [row.epochId, row._count._all]),
    );

    return epochs
      .map((epoch) => ({
        epochId: epoch.id,
        name: epoch.name,
        works: worksMap.get(epoch.id) ?? 0,
      }))
      .sort((a, b) => b.works - a.works);
  }
}
