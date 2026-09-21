import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { runAggregate } from './raw-aggregate';

const DAY_MS = 24 * 60 * 60 * 1000;

interface FacetCount {
  n: number;
}

interface UserFacets {
  total: FacetCount[];
  ativos30d: FacetCount[];
  novos30d: FacetCount[];
  novos7d: FacetCount[];
  onboarding: FacetCount[];
  porRole: Array<{ _id: number; n: number }>;
}

@Injectable()
export class PlatformOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Números de base da plataforma.
   *
   * **As contagens da mesma coleção vão numa passada só, com `$facet`.** O
   * legado disparava uma consulta por número — em `admin/stats` e
   * `admin/insights` eram dezenas, muitas repetindo a mesma varredura com
   * filtro ligeiramente diferente. Seis contagens sobre usuários viram um
   * `$facet`; o que é de coleções diferentes continua em paralelo, porque aí
   * não há passada para compartilhar.
   */
  async overview() {
    const agora = Date.now();
    const trintaDias = new Date(agora - 30 * DAY_MS);
    const seteDias = new Date(agora - 7 * DAY_MS);

    const [usuarios, catalogo, portal, biblioteca] = await Promise.all([
      this.userFacets(trintaDias, seteDias),
      this.catalogCounts(),
      this.portalCounts(),
      this.libraryCounts(),
    ]);

    return {
      generatedAt: new Date(),
      usuarios,
      catalogo,
      portal,
      biblioteca,
    };
  }

  private async userFacets(trintaDias: Date, seteDias: Date) {
    const [facets] = await this.raw<UserFacets>('User', [
      {
        $facet: {
          total: [{ $count: 'n' }],
          ativos30d: [
            { $match: { lastSeen: { $gte: trintaDias } } },
            { $count: 'n' },
          ],
          novos30d: [
            { $match: { createdAt: { $gte: trintaDias } } },
            { $count: 'n' },
          ],
          novos7d: [
            { $match: { createdAt: { $gte: seteDias } } },
            { $count: 'n' },
          ],
          onboarding: [
            { $match: { onboardingCompleted: true } },
            { $count: 'n' },
          ],
          porRole: [{ $group: { _id: '$role', n: { $sum: 1 } } }],
        },
      },
    ]);

    const valor = (rows: FacetCount[] | undefined): number => rows?.[0]?.n ?? 0;

    return {
      total: valor(facets?.total),
      ativosUltimos30Dias: valor(facets?.ativos30d),
      novosUltimos30Dias: valor(facets?.novos30d),
      novosUltimos7Dias: valor(facets?.novos7d),
      onboardingConcluido: valor(facets?.onboarding),
      porPapel: Object.fromEntries(
        (facets?.porRole ?? []).map((row) => [String(row._id), row.n]),
      ),
    };
  }

  private async catalogCounts() {
    const [compositores, obras, partituras, obrasVerificadas] =
      await Promise.all([
        this.prisma.composer.count(),
        this.prisma.work.count(),
        this.prisma.workScore.count({ where: { isActive: true } }),
        this.prisma.work.count({ where: { isVerified: true } }),
      ]);

    return { compositores, obras, partituras, obrasVerificadas };
  }

  private async portalCounts() {
    const [professores, alunos, aulas, tarefas, relatorios] = await Promise.all(
      [
        this.prisma.teacher.count(),
        this.prisma.student.count(),
        this.prisma.lesson.count(),
        this.prisma.assignment.count(),
        this.prisma.sharedProgressReport.count(),
      ],
    );

    return { professores, alunos, aulas, tarefas, relatorios };
  }

  private async libraryCounts() {
    const [favoritos, intencoes, conclusoes, anotacoes] = await Promise.all([
      this.prisma.favoriteWork.count(),
      this.prisma.wantToLearn.count(),
      this.prisma.learned.count(),
      this.prisma.workAnnotation.count(),
    ]);

    return { favoritos, intencoes, conclusoes, anotacoes };
  }

  private raw<T>(
    collection: string,
    pipeline: Record<string, unknown>[],
  ): Promise<T[]> {
    return runAggregate<T>(this.prisma, collection, pipeline);
  }
}
