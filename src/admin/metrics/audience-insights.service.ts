import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInsight, Insight, percent } from './insight';
import { runAggregate } from './raw-aggregate';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela para considerar que o usuário voltou depois do cadastro. */
const ACTIVATION_WINDOW_DAYS = 7;

/** Sem sinal de vida além disto, a conta é considerada dormente. */
const DORMANT_DAYS = 60;

const COHORT_MONTHS = 6;

@Injectable()
export class AudienceInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(): Promise<Insight[]> {
    const [activation, dormant, onboarding, cohorts] = await Promise.all([
      this.activation(),
      this.dormantAccounts(),
      this.onboardingDropoff(),
      this.retentionCohorts(),
    ]);

    return [activation, dormant, onboarding, cohorts];
  }

  /**
   * Quantos usuários fazem alguma coisa de valor na primeira semana.
   *
   * "Alguma coisa de valor" é uma ação concreta — favoritar, marcar "quero
   * aprender", concluir uma obra ou anotar — e não apenas abrir o site. É a
   * medida que separa cadastro de uso.
   */
  private async activation(): Promise<Insight> {
    const since = new Date(Date.now() - 90 * DAY_MS);

    const recentes = await this.prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, createdAt: true },
      take: 5000,
    });

    if (recentes.length === 0) {
      return buildInsight({
        code: 'audience.activation',
        title: 'Ativação na primeira semana',
        severity: 'healthy',
        detail: 'Nenhum cadastro nos últimos 90 dias.',
        value: null,
        unit: 'percent',
        sampleSize: 0,
        minimumSample: 10,
      });
    }

    const ids = recentes.map((user) => user.id);

    // Uma consulta por tipo de ação, em vez de uma por usuário.
    const [favoritos, intencoes, conclusoes, anotacoes] = await Promise.all([
      this.prisma.favoriteWork.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, createdAt: true },
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, addedAt: true },
      }),
      this.prisma.learned.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, learnedAt: true },
      }),
      this.prisma.workAnnotation.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, createdAt: true },
      }),
    ]);

    const primeiraAcao = new Map<string, Date>();

    const registrar = (userId: string, quando: Date | null) => {
      if (!quando) {
        return;
      }

      const atual = primeiraAcao.get(userId);

      if (!atual || quando < atual) {
        primeiraAcao.set(userId, quando);
      }
    };

    for (const row of favoritos) registrar(row.userId, row.createdAt);
    for (const row of intencoes) registrar(row.userId, row.addedAt);
    for (const row of conclusoes) registrar(row.userId, row.learnedAt);
    for (const row of anotacoes) registrar(row.userId, row.createdAt);

    const ativados = recentes.filter((user) => {
      const acao = primeiraAcao.get(user.id);

      return (
        acao !== undefined &&
        acao.getTime() - user.createdAt.getTime() <=
          ACTIVATION_WINDOW_DAYS * DAY_MS
      );
    });

    const rate = percent(ativados.length, recentes.length) ?? 0;

    const tempos = ativados
      .map(
        (user) =>
          ((primeiraAcao.get(user.id) as Date).getTime() -
            user.createdAt.getTime()) /
          DAY_MS,
      )
      .sort((a, b) => a - b);

    const mediana =
      tempos.length > 0 ? tempos[Math.floor(tempos.length / 2)] : null;

    return buildInsight({
      code: 'audience.activation',
      title: `Ativação em até ${ACTIVATION_WINDOW_DAYS} dias`,
      severity: rate < 20 ? 'critical' : rate < 40 ? 'warning' : 'healthy',
      detail: `${ativados.length} de ${recentes.length} cadastros dos últimos 90 dias fizeram alguma ação de valor na primeira semana. Mediana de ${mediana === null ? '—' : mediana.toFixed(1)} dia(s) até a primeira ação.`,
      value: rate,
      unit: 'percent',
      sampleSize: recentes.length,
      minimumSample: 10,
      action:
        rate < 40
          ? 'A maior parte dos cadastros não chega a usar. Olhar o primeiro passo depois do cadastro.'
          : undefined,
      evidence: [
        {
          cadastros: recentes.length,
          ativados: ativados.length,
          medianaDiasAteAcao: mediana,
        },
      ],
    });
  }

  /**
   * Contas sem sinal de vida.
   *
   * Separa quem **nunca** voltou de quem sumiu depois: são problemas
   * diferentes. O primeiro é de recepção; o segundo, de retenção.
   */
  private async dormantAccounts(): Promise<Insight> {
    const cutoff = new Date(Date.now() - DORMANT_DAYS * DAY_MS);

    // `nuncaVoltaram` sai por diferença, e não de `where: { lastSeen: null }`.
    // No MongoDB o campo nunca escrito fica **ausente**, e o Prisma distingue
    // ausente de nulo: o filtro por `null` devolveria zero mesmo com catorze
    // contas sem nenhum acesso registrado. Medi na base — a consulta parecia
    // certa e respondia errado.
    const [total, comAcesso, sumiram] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { lastSeen: { not: null } } }),
      this.prisma.user.count({ where: { lastSeen: { lt: cutoff } } }),
    ]);

    const nuncaVoltaram = total - comAcesso;

    const dormentes = nuncaVoltaram + sumiram;
    const share = percent(dormentes, total) ?? 0;

    return buildInsight({
      code: 'audience.dormant',
      title: `Contas sem uso há mais de ${DORMANT_DAYS} dias`,
      severity: share > 60 ? 'warning' : share > 30 ? 'opportunity' : 'healthy',
      detail: `${nuncaVoltaram} conta(s) nunca registraram acesso e ${sumiram} não aparecem há mais de ${DORMANT_DAYS} dias, de ${total}. São problemas diferentes: o primeiro é de recepção, o segundo de retenção.`,
      value: share,
      unit: 'percent',
      sampleSize: total,
      minimumSample: 10,
      evidence: [{ nuncaVoltaram, sumiram, total }],
    });
  }

  /** Cadastros que pararam antes de concluir o preenchimento inicial. */
  private async onboardingDropoff(): Promise<Insight> {
    const [total, concluido] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { onboardingCompleted: true } }),
    ]);

    const abandono = percent(total - concluido, total) ?? 0;

    return buildInsight({
      code: 'audience.onboarding_dropoff',
      title: 'Cadastro inicial não concluído',
      severity:
        abandono > 60 ? 'warning' : abandono > 30 ? 'opportunity' : 'healthy',
      detail: `${total - concluido} de ${total} contas não concluíram o cadastro inicial.`,
      value: abandono,
      unit: 'percent',
      sampleSize: total,
      minimumSample: 10,
      action:
        abandono > 30
          ? 'Encurtar o cadastro inicial ou permitir concluí-lo depois.'
          : undefined,
      evidence: [{ total, concluido }],
    });
  }

  /**
   * Retorno por coorte de cadastro.
   *
   * Agrupa por mês de entrada e mede quantos daquele grupo voltaram nos 30 dias
   * seguintes. Coorte é o único jeito de ver se o produto está melhorando: a
   * taxa global mistura quem entrou ontem com quem entrou há um ano.
   *
   * O agrupamento por mês roda no banco, com `$dateToString` — o Prisma tipado
   * não expressa truncamento de data.
   */
  private async retentionCohorts(): Promise<Insight> {
    const since = new Date();
    since.setMonth(since.getMonth() - COHORT_MONTHS);

    const rows = await this.raw<{
      _id: string;
      total: number;
      retornaram: number;
    }>('User', [
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          total: { $sum: 1 },
          retornaram: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$lastSeen', null] },
                    {
                      $gt: [{ $subtract: ['$lastSeen', '$createdAt'] }, DAY_MS],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const retornaram = rows.reduce((sum, row) => sum + row.retornaram, 0);
    const rate = percent(retornaram, total);

    const coortes = rows.map((row) => ({
      mes: row._id,
      cadastros: row.total,
      retornaram: row.retornaram,
      taxa: percent(row.retornaram, row.total),
    }));

    // Tendência entre a primeira e a última coorte com base suficiente.
    const comBase = coortes.filter((c) => c.cadastros >= 5 && c.taxa !== null);
    const tendencia =
      comBase.length >= 2
        ? Math.round(
            ((comBase[comBase.length - 1].taxa as number) -
              (comBase[0].taxa as number)) *
              10,
          ) / 10
        : null;

    return buildInsight({
      code: 'audience.retention_cohorts',
      title: `Retorno por coorte de cadastro (${COHORT_MONTHS} meses)`,
      severity:
        rate === null
          ? 'healthy'
          : rate < 25
            ? 'warning'
            : rate < 50
              ? 'opportunity'
              : 'healthy',
      detail:
        tendencia === null
          ? `${retornaram} de ${total} cadastros voltaram depois do primeiro dia.`
          : `${retornaram} de ${total} cadastros voltaram depois do primeiro dia. Entre a coorte mais antiga e a mais recente, a taxa ${tendencia >= 0 ? 'subiu' : 'caiu'} ${Math.abs(tendencia)} ponto(s).`,
      value: rate,
      unit: 'percent',
      sampleSize: total,
      minimumSample: 10,
      evidence: coortes,
    });
  }

  private raw<T>(
    collection: string,
    pipeline: Record<string, unknown>[],
  ): Promise<T[]> {
    return runAggregate<T>(this.prisma, collection, pipeline);
  }
}
