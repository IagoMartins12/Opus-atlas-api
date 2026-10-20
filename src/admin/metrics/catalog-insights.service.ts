import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInsight, Insight, percent } from './insight';
import { runAggregate, toObjectId } from './raw-aggregate';
import { dueAt } from '../../uploads/moderation/moderation-sla';
import { ReportPriority } from '../../uploads/moderation/report-categories';

/** Quantas obras examinar por critério antes de cruzar com a oferta. */
const CANDIDATES = 200;

const EVIDENCE = 20;

interface DemandRow {
  _id: string;
  demanda: number;
}

interface WorkRef {
  id: string;
  title: string;
  composer: string;
}

@Injectable()
export class CatalogInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(): Promise<Insight[]> {
    const [gap, unverifiedDemand, orphans, coverage, sla] = await Promise.all([
      this.demandWithoutSupply(),
      this.popularButUnverified(),
      this.unplayableWorks(),
      this.verificationCoverage(),
      this.moderationSla(),
    ]);

    return [gap, unverifiedDemand, orphans, coverage, sla];
  }

  /**
   * Obras que os alunos querem aprender e para as quais não há partitura ativa.
   *
   * É o insight mais acionável do catálogo: cada item é uma obra com demanda
   * comprovada e oferta zero — a fila de upload ordenada por quem está
   * esperando, em vez de por ordem alfabética.
   *
   * O cruzamento roda no banco, com `$lookup` limitado a uma partitura por
   * obra: só interessa saber **se existe**, não quantas são.
   */
  private async demandWithoutSupply(): Promise<Insight> {
    const rows = await this.raw<DemandRow & { partituras: unknown[] }>(
      'WantToLearn',
      [
        { $group: { _id: '$workId', demanda: { $sum: 1 } } },
        { $sort: { demanda: -1 } },
        { $limit: CANDIDATES },
        {
          $lookup: {
            from: 'work_scores',
            localField: '_id',
            foreignField: 'workId',
            pipeline: [{ $match: { isActive: true } }, { $limit: 1 }],
            as: 'partituras',
          },
        },
        { $match: { partituras: { $size: 0 } } },
        { $limit: EVIDENCE },
      ],
    );

    const total = await this.prisma.wantToLearn.count();
    const ids = rows
      .map((row) => toObjectId(row._id))
      .filter((id): id is string => id !== null);

    const works = await this.resolveWorks(ids);

    return buildInsight({
      code: 'catalog.demand_without_supply',
      title: 'Obras procuradas sem partitura disponível',
      severity: rows.length > 0 ? 'opportunity' : 'healthy',
      detail:
        rows.length > 0
          ? `${rows.length} das ${CANDIDATES} obras mais procuradas não têm nenhuma partitura ativa. Cada uma é demanda comprovada com oferta zero.`
          : 'Todas as obras mais procuradas têm partitura ativa.',
      value: rows.length,
      unit: 'count',
      sampleSize: total,
      minimumSample: 10,
      action:
        rows.length > 0
          ? 'Priorizar a fila de upload por estas obras, na ordem da demanda.'
          : undefined,
      evidence: rows.map((row) => {
        const id = toObjectId(row._id);

        return {
          ...(works.get(id ?? '') ?? { id, title: null, composer: null }),
          alunosEsperando: row.demanda,
        };
      }),
    });
  }

  /**
   * Compositores com procura alta e nenhuma obra verificada.
   *
   * Curadoria costuma andar por ordem de cadastro. Isto diz por onde começar
   * para que o esforço alcance mais gente.
   */
  private async popularButUnverified(): Promise<Insight> {
    const rows = await this.raw<{ _id: string; demanda: number }>(
      'FavoriteComposer',
      [
        { $group: { _id: '$composerId', demanda: { $sum: 1 } } },
        { $sort: { demanda: -1 } },
        { $limit: CANDIDATES },
      ],
    );

    if (rows.length === 0) {
      return buildInsight({
        code: 'catalog.popular_unverified',
        title: 'Compositores procurados ainda não verificados',
        severity: 'healthy',
        detail: 'Sem dados de preferência suficientes.',
        value: 0,
        unit: 'count',
        sampleSize: 0,
        minimumSample: 10,
      });
    }

    const ids = rows
      .map((row) => toObjectId(row._id))
      .filter((id): id is string => id !== null);

    const unverified = await this.prisma.composer.findMany({
      where: { id: { in: ids }, isVerified: false },
      select: { id: true, name: true },
      take: EVIDENCE,
    });

    const demandById = new Map(
      rows.map((row) => [toObjectId(row._id) ?? '', row.demanda]),
    );

    return buildInsight({
      code: 'catalog.popular_unverified',
      title: 'Compositores procurados ainda não verificados',
      severity: unverified.length > 0 ? 'opportunity' : 'healthy',
      detail:
        unverified.length > 0
          ? `${unverified.length} dos compositores mais favoritados seguem sem verificação.`
          : 'Os compositores mais favoritados já estão verificados.',
      value: unverified.length,
      unit: 'count',
      sampleSize: ids.length,
      minimumSample: 10,
      action:
        unverified.length > 0
          ? 'Reordenar a fila de curadoria por procura, não por data de cadastro.'
          : undefined,
      evidence: unverified
        .map((composer) => ({
          ...composer,
          favoritos: demandById.get(composer.id) ?? 0,
        }))
        .sort((a, b) => b.favoritos - a.favoritos),
    });
  }

  /**
   * Obras que existem no catálogo mas não podem ser estudadas.
   *
   * Uma obra sem nenhuma partitura ativa aparece na navegação e não leva a
   * lugar nenhum. É a maior lacuna do produto hoje.
   *
   * **A consulta é feita ao contrário de propósito.** Perguntar "quais obras
   * não têm partitura" exige varrer as 207 mil obras com `$lookup` — medi:
   * 12,7 segundos. Perguntar "quantas obras distintas têm partitura ativa"
   * agrupa as 92 mil partituras e responde em 222 ms, com o mesmo número. A
   * diferença é de qual lado da relação se parte.
   */
  private async unplayableWorks(): Promise<Insight> {
    const [total, comPartitura] = await Promise.all([
      this.prisma.work.count(),
      this.distinctWorksWithActiveScore(),
    ]);

    const sem = total - comPartitura;
    const share = percent(sem, total) ?? 0;

    const exemplos = await this.raw<{ _id: string; demanda: number }>(
      'WantToLearn',
      [
        { $group: { _id: '$workId', demanda: { $sum: 1 } } },
        { $sort: { demanda: -1 } },
        { $limit: 50 },
      ],
    );

    return buildInsight({
      code: 'catalog.works_without_score',
      title: 'Obras no catálogo sem nenhuma partitura',
      severity: share > 50 ? 'warning' : share > 20 ? 'opportunity' : 'healthy',
      detail: `${sem} de ${total} obras não têm nenhuma partitura ativa. Elas aparecem na navegação e não levam a lugar nenhum.`,
      value: share,
      unit: 'percent',
      sampleSize: total,
      minimumSample: 50,
      action:
        share > 20
          ? 'Cruzar com a procura dos alunos para decidir quais preencher primeiro.'
          : undefined,
      evidence: [
        { obrasComPartitura: comPartitura, obrasSemPartitura: sem },
        { obrasMaisProcuradas: exemplos.length },
      ],
    });
  }

  /**
   * Obras distintas que têm ao menos uma partitura ativa.
   *
   * Agrupa do lado das partituras, que é a coleção menor.
   */
  private async distinctWorksWithActiveScore(): Promise<number> {
    const rows = await this.raw<{ n: number }>('work_scores', [
      { $match: { isActive: true } },
      { $group: { _id: '$workId' } },
      { $count: 'n' },
    ]);

    return rows[0]?.n ?? 0;
  }

  /** Cobertura de verificação, com o número absoluto que falta. */
  private async verificationCoverage(): Promise<Insight> {
    const [obras, obrasVerificadas, compositores, compositoresVerificados] =
      await Promise.all([
        this.prisma.work.count(),
        this.prisma.work.count({ where: { isVerified: true } }),
        this.prisma.composer.count(),
        this.prisma.composer.count({ where: { isVerified: true } }),
      ]);

    const cobertura = percent(
      obrasVerificadas + compositoresVerificados,
      obras + compositores,
    );

    return buildInsight({
      code: 'catalog.verification_coverage',
      title: 'Cobertura de verificação do catálogo',
      severity:
        cobertura === null
          ? 'healthy'
          : cobertura < 10
            ? 'warning'
            : cobertura < 50
              ? 'opportunity'
              : 'healthy',
      detail: `${obrasVerificadas} de ${obras} obras e ${compositoresVerificados} de ${compositores} compositores verificados. Faltam ${obras - obrasVerificadas + compositores - compositoresVerificados} registros.`,
      value: cobertura,
      unit: 'percent',
      sampleSize: obras + compositores,
      minimumSample: 50,
      evidence: [
        { entidade: 'obras', total: obras, verificadas: obrasVerificadas },
        {
          entidade: 'compositores',
          total: compositores,
          verificados: compositoresVerificados,
        },
      ],
    });
  }

  // -------------------------------------------------------------------

  private raw<T>(
    collection: string,
    pipeline: Record<string, unknown>[],
  ): Promise<T[]> {
    return runAggregate<T>(this.prisma, collection, pipeline);
  }

  /** Resolve título e compositor das obras citadas, numa consulta só. */
  private async resolveWorks(ids: string[]): Promise<Map<string, WorkRef>> {
    if (ids.length === 0) {
      return new Map();
    }

    const works = await this.prisma.work.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, composer: { select: { name: true } } },
    });

    return new Map(
      works.map((work) => [
        work.id,
        { id: work.id, title: work.title, composer: work.composer.name },
      ]),
    );
  }

  /**
   * Denúncias resolvidas dentro do prazo (RN-4), nos últimos 30 dias.
   *
   * O prazo depende da prioridade (24 h a 30 dias); a medida é a fração das
   * resolvidas que fecharam antes do vencimento. As abertas que já venceram
   * vão como evidência — são as que pesam na próxima leitura.
   */
  private async moderationSla(): Promise<Insight> {
    const agora = new Date();
    const desde = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [resolvidas, abertas] = await Promise.all([
      this.prisma.uploadModeration.findMany({
        where: { resolvedAt: { gte: desde } },
        select: { createdAt: true, resolvedAt: true, priority: true },
        take: 5_000,
      }),
      this.prisma.uploadModeration.findMany({
        where: { status: 'pending' },
        select: {
          id: true,
          reason: true,
          priority: true,
          createdAt: true,
          entityType: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ]);

    const prioridade = (p: string) =>
      (['urgent', 'high', 'normal', 'low'].includes(p)
        ? p
        : 'normal') as ReportPriority;

    const noPrazo = resolvidas.filter(
      (r) =>
        r.resolvedAt &&
        r.resolvedAt <= dueAt(r.createdAt, prioridade(r.priority)),
    ).length;
    const vencidas = abertas.filter(
      (r) => dueAt(r.createdAt, prioridade(r.priority)) < agora,
    );
    const taxa = percent(noPrazo, resolvidas.length);

    return buildInsight({
      code: 'catalog.moderation_sla',
      title: 'Denúncias resolvidas no prazo',
      severity:
        vencidas.length > 0 && (taxa === null || taxa < 80)
          ? 'warning'
          : taxa !== null && taxa < 90
            ? 'opportunity'
            : 'healthy',
      detail: `${noPrazo} de ${resolvidas.length} denúncia(s) resolvida(s) nos últimos 30 dias fecharam no prazo. ${vencidas.length} aberta(s) já passaram do prazo.`,
      value: taxa,
      unit: 'percent',
      sampleSize: resolvidas.length,
      minimumSample: 5,
      action:
        vencidas.length > 0
          ? 'Comece pelas denúncias vencidas: a fila de Denúncias já ordena pelo prazo.'
          : undefined,
      evidence: vencidas.slice(0, EVIDENCE),
    });
  }
}
