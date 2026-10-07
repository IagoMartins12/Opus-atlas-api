import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { runAggregate } from './raw-aggregate';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cada série do painel: o nome, a coleção e o campo de data. */
const SERIES_DE_ATIVIDADE = [
  ['cadastros', 'User', 'createdAt'],
  ['anotacoes', 'work_annotations', 'createdAt'],
  ['envios', 'upload_history', 'createdAt'],
  ['favoritos', 'FavoriteWork', 'createdAt'],
  ['querem', 'WantToLearn', 'addedAt'],
  ['aprendidas', 'Learned', 'learnedAt'],
  ['comentarios', 'blog_comments', 'createdAt'],
  ['partituras', 'work_scores', 'createdAt'],
] as const;

type SerieDeAtividade = (typeof SERIES_DE_ATIVIDADE)[number][0];

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
  /**
   * Cadastros, anotações, envios, favoritos, quero aprender, aprendidas, comentários
   * do blog e partituras novas por dia, no fuso de São Paulo, com o total da
   * janela anterior de mesmo tamanho para comparar.
   *
   * O painel antigo mostrava "crescimento" e "usuários diários" zerados de
   * propósito — não havia série no tempo para ler. Aqui ela vem agrupada no
   * banco (`$dateToString`), e os dias sem nada aparecem com zero: um gráfico
   * que pula o domingo vazio mente sobre o ritmo.
   */
  async activity(days: number) {
    const diaSP = (d: Date) =>
      d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    // Meia-noite de São Paulo do primeiro dia (o Brasil não tem mais horário
    // de verão: -03:00 o ano inteiro).
    const primeiro = diaSP(new Date(Date.now() - (days - 1) * DAY_MS));
    const inicio = new Date(`${primeiro}T00:00:00-03:00`);
    // A janela anterior, do mesmo tamanho, entra na mesma consulta: os dias
    // antes de `primeiro` somam no "antes", para a comparação.
    const inicioAnterior = new Date(inicio.getTime() - days * DAY_MS);

    const porDia = (colecao: string, campo = 'createdAt') =>
      runAggregate<{ _id: string; n: number }>(this.prisma, colecao, [
        {
          $match: {
            [campo]: { $gte: { $date: inicioAnterior.toISOString() } },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: `$${campo}`,
                timezone: 'America/Sao_Paulo',
              },
            },
            n: { $sum: 1 },
          },
        },
      ]);

    const linhas = await Promise.all(
      SERIES_DE_ATIVIDADE.map(([, colecao, campo]) => porDia(colecao, campo)),
    );
    const mapas = linhas.map(
      (l) => new Map(l.map((x) => [x._id, x.n] as const)),
    );

    const dias = Array.from({ length: days }, (_, i) => {
      const chave = diaSP(
        new Date(inicio.getTime() + i * DAY_MS + 12 * 3_600_000),
      );
      const ponto: Record<string, number | string> = { dia: chave };
      SERIES_DE_ATIVIDADE.forEach(([nome], k) => {
        ponto[nome] = mapas[k].get(chave) ?? 0;
      });
      return ponto as { dia: string } & Record<SerieDeAtividade, number>;
    });

    const totais = {} as Record<SerieDeAtividade, number>;
    const anteriores = {} as Record<SerieDeAtividade, number>;
    SERIES_DE_ATIVIDADE.forEach(([nome], k) => {
      totais[nome] = dias.reduce((s, d) => s + d[nome], 0);
      anteriores[nome] = linhas[k]
        .filter((x) => x._id < primeiro)
        .reduce((s, x) => s + x.n, 0);
    });

    return {
      dias: days,
      serie: dias,
      totais,
      totaisAnteriores: anteriores,
    };
  }

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
