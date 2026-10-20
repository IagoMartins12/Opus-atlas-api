import { Injectable } from '@nestjs/common';
import {
  PlanType,
  StorageAssetKind,
  StorageAssetStatus,
  StudentInviteStatus,
  SubscriptionPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_FEATURES } from '../../billing/constants/plan-features.constants';
import { buildInsight, Insight, percent } from './insight';

const EVIDENCE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MonetizationInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(): Promise<Insight[]> {
    const [distribution, trial, atLimit, expiring, churn, abandono] =
      await Promise.all([
        this.planDistribution(),
        this.trialConversion(),
        this.usersAtPlanLimit(),
        this.expiringTrials(),
        this.churn(),
        this.checkoutAbandonment(),
      ]);

    return [distribution, trial, atLimit, expiring, churn, abandono];
  }

  /** Distribuição de assinaturas por plano, com a fatia paga destacada. */
  private async planDistribution(): Promise<Insight> {
    const [porPlano, usuarios] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['planType'],
        where: {
          status: {
            in: [SubscriptionPlanStatus.ACTIVE, SubscriptionPlanStatus.TRIAL],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.user.count(),
    ]);

    const porPlanoMap = new Map(
      porPlano.map((row) => [row.planType, row._count._all]),
    );

    const pagantes = porPlano
      .filter((row) => row.planType !== PlanType.FREE)
      .reduce((sum, row) => sum + row._count._all, 0);

    const share = percent(pagantes, usuarios);

    return buildInsight({
      code: 'monetization.plan_distribution',
      title: 'Distribuição de planos',
      severity: 'healthy',
      detail: `${pagantes} assinatura(s) paga(s) entre ${usuarios} conta(s).`,
      value: share,
      unit: 'percent',
      sampleSize: usuarios,
      minimumSample: 10,
      evidence: Object.values(PlanType).map((plano) => ({
        plano,
        assinaturas: porPlanoMap.get(plano) ?? 0,
      })),
    });
  }

  /** Quanto dos testes vira assinatura paga. */
  private async trialConversion(): Promise<Insight> {
    const [emTeste, pagos, cancelados] = await Promise.all([
      this.prisma.subscription.count({
        where: { status: SubscriptionPlanStatus.TRIAL },
      }),
      this.prisma.subscription.count({
        where: {
          status: SubscriptionPlanStatus.ACTIVE,
          planType: { not: PlanType.FREE },
        },
      }),
      this.prisma.subscription.count({
        where: { status: SubscriptionPlanStatus.CANCELLED },
      }),
    ]);

    const base = pagos + cancelados;
    const rate = percent(pagos, base);

    return buildInsight({
      code: 'monetization.trial_conversion',
      title: 'Conversão para plano pago',
      severity:
        rate === null
          ? 'healthy'
          : rate < 20
            ? 'warning'
            : rate < 40
              ? 'opportunity'
              : 'healthy',
      detail: `${pagos} assinatura(s) paga(s) contra ${cancelados} cancelada(s). ${emTeste} em período de teste agora.`,
      value: rate,
      unit: 'percent',
      sampleSize: base,
      minimumSample: 10,
      evidence: [{ emTeste, pagos, cancelados }],
    });
  }

  /**
   * Quem está no teto do próprio plano.
   *
   * É a lista de candidatos a upgrade que não depende de suposição: são contas
   * que **já esbarraram** no limite. O legado tinha uma seção de monetização,
   * mas os números dela vinham de estimativas com fator aleatório.
   */
  private async usersAtPlanLimit(): Promise<Insight> {
    const assinaturas = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [SubscriptionPlanStatus.ACTIVE, SubscriptionPlanStatus.TRIAL],
        },
      },
      select: { userId: true, planType: true },
      take: 5000,
    });

    if (assinaturas.length === 0) {
      return buildInsight({
        code: 'monetization.at_plan_limit',
        title: 'Contas no teto do plano',
        severity: 'healthy',
        detail: 'Não há assinaturas ativas.',
        value: 0,
        unit: 'count',
        sampleSize: 0,
        minimumSample: 5,
      });
    }

    const userIds = assinaturas.map((assinatura) => assinatura.userId);

    const [uploads, professores] = await Promise.all([
      this.prisma.storedAsset.groupBy({
        by: ['ownerId'],
        where: {
          ownerId: { in: userIds },
          status: StorageAssetStatus.ACTIVE,
          kind: StorageAssetKind.SCORE_FILE,
        },
        _count: { _all: true },
      }),
      this.prisma.teacher.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          _count: {
            select: {
              students: {
                where: {
                  isActive: true,
                  inviteStatus: StudentInviteStatus.ACCEPTED,
                },
              },
            },
          },
        },
      }),
    ]);

    const uploadsPorUsuario = new Map(
      uploads
        .filter((row): row is typeof row & { ownerId: string } =>
          Boolean(row.ownerId),
        )
        .map((row) => [row.ownerId, row._count._all]),
    );

    const alunosPorUsuario = new Map(
      professores.map((teacher) => [teacher.userId, teacher._count.students]),
    );

    const noTeto = assinaturas.flatMap((assinatura) => {
      const features = PLAN_FEATURES[assinatura.planType];
      const motivos: string[] = [];

      const enviados = uploadsPorUsuario.get(assinatura.userId) ?? 0;
      const alunos = alunosPorUsuario.get(assinatura.userId) ?? 0;

      // Só há teto quando o limite é positivo: -1 é ilimitado e 0 é recurso
      // que o plano não oferece. Com `>= 0`, todo plano sem alunos (0) punha
      // cada assinante no teto com "0/0 alunos" — inclusive quem nem é
      // professor — e a lista de upgrade virava a base inteira.
      if (features.uploadLimit > 0 && enviados >= features.uploadLimit) {
        motivos.push(`${enviados}/${features.uploadLimit} envios`);
      }

      if (features.maxStudents > 0 && alunos >= features.maxStudents) {
        motivos.push(`${alunos}/${features.maxStudents} alunos`);
      }

      return motivos.length > 0
        ? [{ userId: assinatura.userId, plano: assinatura.planType, motivos }]
        : [];
    });

    const share = percent(noTeto.length, assinaturas.length) ?? 0;

    return buildInsight({
      code: 'monetization.at_plan_limit',
      title: 'Contas que já esbarraram no teto do plano',
      severity: noTeto.length > 0 ? 'opportunity' : 'healthy',
      detail: `${noTeto.length} de ${assinaturas.length} assinaturas ativas estão no limite de envios ou de alunos do plano atual.`,
      value: share,
      unit: 'percent',
      sampleSize: assinaturas.length,
      minimumSample: 5,
      action:
        noTeto.length > 0
          ? 'Estas contas já bateram no limite: é a lista de upgrade que não depende de suposição.'
          : undefined,
      evidence: noTeto.slice(0, EVIDENCE),
    });
  }

  /** Testes que acabam nos próximos sete dias. */
  private async expiringTrials(): Promise<Insight> {
    const agora = new Date();
    const limite = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [expirando, emTeste] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          status: SubscriptionPlanStatus.TRIAL,
          trialEndDate: { gte: agora, lte: limite },
        },
        select: { userId: true, planType: true, trialEndDate: true },
        orderBy: { trialEndDate: 'asc' },
        take: EVIDENCE,
      }),
      this.prisma.subscription.count({
        where: { status: SubscriptionPlanStatus.TRIAL },
      }),
    ]);

    return buildInsight({
      code: 'monetization.expiring_trials',
      title: 'Testes que terminam nos próximos 7 dias',
      severity: expirando.length > 0 ? 'opportunity' : 'healthy',
      detail: `${expirando.length} de ${emTeste} testes em andamento terminam nesta semana.`,
      value: expirando.length,
      unit: 'count',
      sampleSize: emTeste,
      minimumSample: 3,
      action:
        expirando.length > 0
          ? 'Janela de contato mais útil do funil — o produto ainda está em uso.'
          : undefined,
      evidence: expirando,
    });
  }

  /**
   * Cancelamentos nos últimos 30 dias sobre quem pagava no começo da janela.
   *
   * A base é quem **já tinha** plano pago vivo há 30 dias — contar quem entrou
   * durante a janela no denominador faria um mês de muita venda esconder um
   * mês de muita saída.
   */
  private async churn(): Promise<Insight> {
    const agora = new Date();
    const desde = new Date(agora.getTime() - 30 * DAY_MS);
    const pagas = { planType: { not: PlanType.FREE } };

    const [base, cancelaram, recentes] = await Promise.all([
      this.prisma.subscription.count({
        where: {
          ...pagas,
          status: { not: SubscriptionPlanStatus.PENDING },
          startDate: { lt: desde },
          AND: [
            { OR: [{ cancelledAt: null }, { cancelledAt: { gte: desde } }] },
            { OR: [{ endDate: null }, { endDate: { gte: desde } }] },
          ],
        },
      }),
      this.prisma.subscription.count({
        where: { ...pagas, cancelledAt: { gte: desde } },
      }),
      this.prisma.subscription.findMany({
        where: { ...pagas, cancelledAt: { gte: desde } },
        select: {
          userId: true,
          planType: true,
          billingPeriod: true,
          cancelledAt: true,
        },
        orderBy: { cancelledAt: 'desc' },
        take: EVIDENCE,
      }),
    ]);

    const taxa = percent(cancelaram, base);

    return buildInsight({
      code: 'monetization.churn',
      title: 'Cancelamentos nos últimos 30 dias',
      severity:
        taxa === null
          ? 'healthy'
          : taxa >= 10
            ? 'critical'
            : taxa >= 5
              ? 'warning'
              : 'healthy',
      detail: `${cancelaram} cancelamento(s) entre ${base} assinatura(s) paga(s) que existiam há 30 dias.`,
      value: taxa,
      unit: 'percent',
      sampleSize: base,
      minimumSample: 10,
      action:
        taxa !== null && taxa >= 5
          ? 'Leia os motivos no histórico das assinaturas canceladas e fale com quem saiu nesta semana.'
          : undefined,
      evidence: recentes,
    });
  }

  /**
   * Checkouts abertos e nunca pagos (mais de um dia sem pagamento).
   *
   * É o funil que o Stripe não mostra: a pessoa escolheu o plano, chegou ao
   * cartão e desistiu. Taxa alta costuma ser preço, método de pagamento que
   * falta ou erro no próprio checkout.
   */
  private async checkoutAbandonment(): Promise<Insight> {
    const agora = new Date();
    const desde = new Date(agora.getTime() - 30 * DAY_MS);
    const umDia = new Date(agora.getTime() - DAY_MS);
    const janela = { gte: desde, lt: umDia };

    const [abandonados, iniciados, exemplos] = await Promise.all([
      this.prisma.subscription.count({
        where: { status: SubscriptionPlanStatus.PENDING, createdAt: janela },
      }),
      this.prisma.subscription.count({
        where: { planType: { not: PlanType.FREE }, createdAt: janela },
      }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionPlanStatus.PENDING, createdAt: janela },
        select: {
          userId: true,
          planType: true,
          billingPeriod: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EVIDENCE,
      }),
    ]);

    const taxa = percent(abandonados, iniciados);

    return buildInsight({
      code: 'monetization.checkout_abandonment',
      title: 'Checkouts abandonados',
      severity:
        taxa === null
          ? 'healthy'
          : taxa >= 60
            ? 'warning'
            : taxa >= 35
              ? 'opportunity'
              : 'healthy',
      detail: `${abandonados} de ${iniciados} checkout(s) abertos nos últimos 30 dias nunca foram pagos.`,
      value: taxa,
      unit: 'percent',
      sampleSize: iniciados,
      minimumSample: 10,
      action:
        taxa !== null && taxa >= 35
          ? 'Confira o checkout de ponta a ponta e se o PIX aparece; um lembrete por e-mail no dia seguinte recupera parte.'
          : undefined,
      evidence: exemplos,
    });
  }
}
