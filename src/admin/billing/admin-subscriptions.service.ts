import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingPeriod,
  PaymentStatus,
  PlanType,
  Prisma,
  SubscriptionPlanStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import { escapeRegex } from '../../common/utils/regex.util';
import { runAggregate } from '../metrics/raw-aggregate';
import {
  EstadoAssinatura,
  ListSubscriptionsQueryDto,
} from './dto/admin-subscriptions.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const FUSO = 'America/Sao_Paulo';

const PAGOS: PlanType[] = [PlanType.PLUS, PlanType.MENTOR, PlanType.MAESTRO];

const { ACTIVE, TRIAL, PAST_DUE, CANCELLED, EXPIRED, PENDING } =
  SubscriptionPlanStatus;

/** Centavos: soma de ponto flutuante não pode virar "R$ 80,72999". */
const reais = (valor: number | null | undefined) =>
  Math.round((valor ?? 0) * 100) / 100;

/**
 * Viva é quem tem acesso ao plano agora: ativa, em teste, em atraso (o
 * Stripe ainda tenta cobrar) ou cancelada com período pago por vencer.
 */
function viva(agora: Date): Prisma.SubscriptionWhereInput {
  return {
    OR: [
      { status: { in: [ACTIVE, TRIAL, PAST_DUE] } },
      { status: CANCELLED, endDate: { gt: agora } },
    ],
  };
}

/** Pagamento dentro de uma janela: pela data do pagamento, senão da criação. */
function pagoEntre(de: Date, ate?: Date): Prisma.PaymentWhereInput {
  const janela = { gte: de, ...(ate ? { lt: ate } : {}) };
  return {
    status: PaymentStatus.APPROVED,
    OR: [{ paidAt: janela }, { paidAt: null, createdAt: janela }],
  };
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  image: true,
} as const;

const nomeDe = (u: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '—';

/**
 * Assinaturas: quem paga, quanto entra e quem vai embora.
 *
 * **Esta tela não existia.** O menu do painel antigo apontava para
 * `/admin/plans/subscribers`, que respondia 404; a única leitura de cobrança
 * era a distribuição de planos dentro dos insights.
 *
 * Todo número sai do banco — `Payment` para dinheiro, `Subscription` para
 * quem tem acesso. Nada é estimado: a receita recorrente é a soma dos preços
 * gravados nas assinaturas que renovam, e as que não têm preço gravado são
 * contadas à parte (`semPreco`) em vez de sumirem da conta em silêncio.
 */
@Injectable()
export class AdminSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(days = 30) {
    const agora = new Date();
    const desde = new Date(agora.getTime() - days * DAY_MS);
    const antes = new Date(desde.getTime() - days * DAY_MS);
    const doze = new Date(agora.getFullYear(), agora.getMonth() - 11, 1);

    const pagas = { planType: { in: PAGOS } };

    const [
      receitaTotal,
      receitaPeriodo,
      receitaAnterior,
      reembolsos,
      porMes,
      porMetodo,
      recorrente,
      porPlanoStatus,
      vaoSair,
      novos,
      cancelaram,
      baseCancelamento,
      expiraram,
      abandonados,
      testesVencendo,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.APPROVED },
        _sum: { finalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: pagoEntre(desde),
        _sum: { finalAmount: true, discountAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: pagoEntre(antes, desde),
        _sum: { finalAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.REFUNDED,
          updatedAt: { gte: desde },
        },
        _sum: { finalAmount: true },
        _count: { _all: true },
      }),
      runAggregate<{ _id: string; valor: number; pagamentos: number }>(
        this.prisma,
        'payments',
        [
          {
            $match: {
              status: 'APPROVED',
              $or: [
                { paidAt: { $gte: { $date: doze.toISOString() } } },
                {
                  paidAt: null,
                  createdAt: { $gte: { $date: doze.toISOString() } },
                },
              ],
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: { $ifNull: ['$paidAt', '$createdAt'] },
                  timezone: FUSO,
                },
              },
              valor: { $sum: '$finalAmount' },
              pagamentos: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      ),
      this.prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: pagoEntre(desde),
        _sum: { finalAmount: true },
        _count: { _all: true },
      }),
      // Recorrente: o que renova sozinho — ativa ou em atraso, nunca a
      // cancelada (ela não volta a cobrar) nem a em teste (ainda não pagou).
      this.prisma.subscription.groupBy({
        by: ['planType', 'billingPeriod'],
        where: { ...pagas, status: { in: [ACTIVE, PAST_DUE] } },
        _sum: { price: true },
        _count: { _all: true, price: true },
      }),
      this.prisma.subscription.groupBy({
        by: ['planType', 'billingPeriod', 'status'],
        where: { ...pagas, ...viva(agora) },
        _count: { _all: true },
      }),
      this.prisma.subscription.count({
        where: { ...pagas, status: CANCELLED, endDate: { gt: agora } },
      }),
      this.prisma.subscription.count({
        where: {
          ...pagas,
          status: { not: PENDING },
          startDate: { gte: desde },
        },
      }),
      this.prisma.subscription.count({
        where: { ...pagas, cancelledAt: { gte: desde } },
      }),
      // Base da taxa: quem tinha plano pago vivo no começo da janela.
      this.prisma.subscription.count({
        where: {
          ...pagas,
          status: { not: PENDING },
          startDate: { lt: desde },
          AND: [
            { OR: [{ cancelledAt: null }, { cancelledAt: { gte: desde } }] },
            { OR: [{ endDate: null }, { endDate: { gte: desde } }] },
          ],
        },
      }),
      this.prisma.subscription.count({
        where: {
          ...pagas,
          status: EXPIRED,
          endDate: { gte: desde, lte: agora },
        },
      }),
      // Checkout aberto há mais de um dia e nunca pago.
      this.prisma.subscription.count({
        where: {
          status: PENDING,
          createdAt: {
            gte: desde,
            lt: new Date(agora.getTime() - DAY_MS),
          },
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: TRIAL,
          trialEndDate: {
            gte: agora,
            lte: new Date(agora.getTime() + 7 * DAY_MS),
          },
        },
      }),
    ]);

    const naoRenovaram = await this.naoRenovaram(agora, 8);

    // --- receita recorrente --------------------------------------------
    let mensal = 0;
    let semPreco = 0;
    const recorrentePorPlano = new Map<PlanType, number>();
    for (const linha of recorrente) {
      const soma = linha._sum.price ?? 0;
      const mes =
        linha.billingPeriod === BillingPeriod.YEARLY ? soma / 12 : soma;
      mensal += mes;
      semPreco += linha._count._all - linha._count.price;
      recorrentePorPlano.set(
        linha.planType,
        (recorrentePorPlano.get(linha.planType) ?? 0) + mes,
      );
    }

    // --- assinantes por plano --------------------------------------------
    const planos = new Map(
      PAGOS.map((p) => [p, { plano: p, mensal: 0, anual: 0, total: 0 }]),
    );
    const porStatus = {
      ativas: 0,
      teste: 0,
      atraso: 0,
      canceladasComAcesso: 0,
    };
    for (const linha of porPlanoStatus) {
      const n = linha._count._all;
      const plano = planos.get(linha.planType);
      if (plano) {
        plano.total += n;
        if (linha.billingPeriod === BillingPeriod.YEARLY) plano.anual += n;
        else plano.mensal += n;
      }
      if (linha.status === ACTIVE) porStatus.ativas += n;
      if (linha.status === TRIAL) porStatus.teste += n;
      if (linha.status === PAST_DUE) porStatus.atraso += n;
      if (linha.status === CANCELLED) porStatus.canceladasComAcesso += n;
    }
    const vivas = [...planos.values()].reduce((s, p) => s + p.total, 0);

    // --- meses sem pagamento aparecem com zero ---------------------------
    const mesesMap = new Map(porMes.map((m) => [m._id, m]));
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(doze.getFullYear(), doze.getMonth() + i, 1);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = mesesMap.get(chave);
      return {
        mes: chave,
        valor: reais(m?.valor),
        pagamentos: m?.pagamentos ?? 0,
      };
    });

    const pagamentosPeriodo = receitaPeriodo._count._all;
    const valorPeriodo = reais(receitaPeriodo._sum.finalAmount);

    return {
      periodo: { dias: days, desde },
      receita: {
        total: reais(receitaTotal._sum.finalAmount),
        pagamentosTotal: receitaTotal._count._all,
        periodo: valorPeriodo,
        periodoAnterior: reais(receitaAnterior._sum.finalAmount),
        pagamentos: pagamentosPeriodo,
        ticketMedio:
          pagamentosPeriodo > 0
            ? reais(valorPeriodo / pagamentosPeriodo)
            : null,
        descontos: reais(receitaPeriodo._sum.discountAmount),
        reembolsos: {
          valor: reais(reembolsos._sum.finalAmount),
          quantidade: reembolsos._count._all,
        },
        porMes: meses,
        porMetodo: porMetodo
          .map((m) => ({
            metodo: m.paymentMethod ?? 'DESCONHECIDO',
            valor: reais(m._sum.finalAmount),
            pagamentos: m._count._all,
          }))
          .sort((a, b) => b.valor - a.valor),
      },
      recorrente: {
        mensal: reais(mensal),
        anualizado: reais(mensal * 12),
        semPreco,
        porPlano: PAGOS.map((p) => ({
          plano: p,
          mensal: reais(recorrentePorPlano.get(p)),
        })),
      },
      assinantes: {
        vivas,
        ...porStatus,
        porPlano: [...planos.values()],
      },
      movimento: {
        novos,
        cancelaram,
        taxaCancelamento: {
          valor:
            baseCancelamento > 0
              ? Math.round((cancelaram / baseCancelamento) * 1000) / 10
              : null,
          base: baseCancelamento,
        },
        expiraram,
        vaoSair,
        naoRenovaram: naoRenovaram.total,
        checkoutsAbandonados: abandonados,
        testesVencendo7Dias: testesVencendo,
      },
      naoRenovaramRecentes: naoRenovaram.recentes,
    };
  }

  /**
   * Quem teve plano pago, deixou vencer e não voltou.
   *
   * "Expirada" sozinho não basta: quem trocou de plano deixa uma assinatura
   * expirada para trás e tem outra viva. Aqui entra só quem não tem nenhuma
   * assinatura paga com acesso hoje.
   */
  private async naoRenovaram(agora: Date, recentes: number) {
    const vivos = await this.usuariosComPlanoVivo(agora);

    const [grupos, linhas] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['userId'],
        where: {
          planType: { in: PAGOS },
          status: EXPIRED,
          userId: { notIn: vivos },
        },
        _count: { _all: true },
      }),
      this.prisma.subscription.findMany({
        where: {
          planType: { in: PAGOS },
          status: EXPIRED,
          userId: { notIn: vivos },
        },
        orderBy: [{ endDate: 'desc' }, { id: 'desc' }],
        take: recentes * 3,
        select: {
          id: true,
          userId: true,
          planType: true,
          billingPeriod: true,
          endDate: true,
          user: { select: USER_SELECT },
        },
      }),
    ]);

    // Uma linha por pessoa: a assinatura que venceu por último.
    const vistos = new Set<string>();
    const unicas = linhas
      .filter((l) => (vistos.has(l.userId) ? false : vistos.add(l.userId)))
      .slice(0, recentes);

    const totais = await this.totalPagoPorUsuario(unicas.map((l) => l.userId));

    return {
      total: grupos.length,
      recentes: unicas.map((l) => ({
        id: l.id,
        usuario: { id: l.user.id, nome: nomeDe(l.user), email: l.user.email },
        plano: l.planType,
        periodo: l.billingPeriod,
        venceuEm: l.endDate,
        totalPago: totais.get(l.userId) ?? 0,
      })),
    };
  }

  private async usuariosComPlanoVivo(agora: Date): Promise<string[]> {
    const linhas = await this.prisma.subscription.findMany({
      where: { planType: { in: PAGOS }, ...viva(agora) },
      select: { userId: true },
      distinct: ['userId'],
    });
    return linhas.map((l) => l.userId);
  }

  private async totalPagoPorUsuario(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, number>();

    const subs = await this.prisma.subscription.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true },
    });
    const dono = new Map(subs.map((s) => [s.id, s.userId]));

    const pagos = await this.prisma.payment.groupBy({
      by: ['subscriptionId'],
      where: {
        status: PaymentStatus.APPROVED,
        subscriptionId: { in: [...dono.keys()] },
      },
      _sum: { finalAmount: true },
    });

    const totais = new Map<string, number>();
    for (const p of pagos) {
      const uid = dono.get(p.subscriptionId);
      if (uid)
        totais.set(
          uid,
          reais((totais.get(uid) ?? 0) + (p._sum.finalAmount ?? 0)),
        );
    }
    return totais;
  }

  // -------------------------------------------------------------------
  // Lista e detalhe
  // -------------------------------------------------------------------

  async list(query: ListSubscriptionsQueryDto) {
    const agora = new Date();
    const limit = query.limit ?? 25;
    const where = await this.whereDaLista(query, agora);

    const paging = pageArgs({ cursor: query.cursor, page: 1, limit });

    const linhas = await this.prisma.subscription.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: paging.take,
      skip: paging.skip,
      cursor: paging.cursor,
      select: {
        id: true,
        userId: true,
        planType: true,
        billingPeriod: true,
        status: true,
        startDate: true,
        endDate: true,
        trialEndDate: true,
        cancelledAt: true,
        price: true,
        currency: true,
        autoRenew: true,
        createdAt: true,
        coupon: { select: { code: true } },
        user: { select: USER_SELECT },
      },
    });

    const [total, pagos] = await Promise.all([
      query.cursor ? null : this.prisma.subscription.count({ where }),
      linhas.length
        ? this.prisma.payment.groupBy({
            by: ['subscriptionId'],
            where: {
              status: PaymentStatus.APPROVED,
              subscriptionId: { in: linhas.map((l) => l.id) },
            },
            _sum: { finalAmount: true },
            _count: { _all: true },
          })
        : [],
    ]);
    const pagosMap = new Map(pagos.map((p) => [p.subscriptionId, p]));

    return {
      items: linhas.map((l) => ({
        id: l.id,
        usuario: {
          id: l.user.id,
          nome: nomeDe(l.user),
          email: l.user.email,
          imagem: l.user.image,
        },
        plano: l.planType,
        periodo: l.billingPeriod,
        status: l.status,
        estado: estadoDe(l, agora),
        inicio: l.startDate,
        fim: l.endDate,
        fimDoTeste: l.trialEndDate,
        canceladaEm: l.cancelledAt,
        preco: l.price,
        moeda: l.currency,
        renovaSozinha: l.autoRenew,
        cupom: l.coupon?.code ?? null,
        criadaEm: l.createdAt,
        totalPago: reais(pagosMap.get(l.id)?._sum.finalAmount),
        pagamentos: pagosMap.get(l.id)?._count._all ?? 0,
      })),
      total,
      nextCursor: nextCursorOf(linhas, limit),
    };
  }

  private async whereDaLista(
    query: ListSubscriptionsQueryDto,
    agora: Date,
  ): Promise<Prisma.SubscriptionWhereInput> {
    const porEstado: Record<EstadoAssinatura, Prisma.SubscriptionWhereInput> = {
      ativas: { status: { in: [ACTIVE, TRIAL, PAST_DUE] } },
      teste: { status: TRIAL },
      atraso: { status: PAST_DUE },
      'vao-sair': { status: CANCELLED, endDate: { gt: agora } },
      'nao-renovaram': {
        status: EXPIRED,
        userId: { notIn: await this.usuariosComPlanoVivo(agora) },
      },
      expiradas: { status: EXPIRED },
      pendentes: { status: PENDING },
      todas: {},
    };

    const where: Prisma.SubscriptionWhereInput = {
      planType: query.plano ? query.plano : { in: PAGOS },
      ...porEstado[query.estado ?? 'ativas'],
      ...(query.periodo ? { billingPeriod: query.periodo } : {}),
    };

    if (query.busca?.trim()) {
      const termo = query.busca.trim();
      const pessoas = await this.prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: escapeRegex(termo), mode: 'insensitive' } },
            {
              firstName: { contains: escapeRegex(termo), mode: 'insensitive' },
            },
            { lastName: { contains: escapeRegex(termo), mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      const ids = pessoas.map((p) => p.id);
      where.AND = [{ userId: { in: ids } }];
    }

    return where;
  }

  async detail(id: string) {
    const agora = new Date();
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        user: { select: { ...USER_SELECT, createdAt: true } },
        coupon: { select: { code: true, type: true, discountValue: true } },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            discountAmount: true,
            finalAmount: true,
            currency: true,
            status: true,
            paymentMethod: true,
            paidAt: true,
            createdAt: true,
          },
        },
        history: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!sub) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    const outras = await this.prisma.subscription.findMany({
      where: { userId: sub.userId, id: { not: sub.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        planType: true,
        billingPeriod: true,
        status: true,
        startDate: true,
        endDate: true,
        cancelledAt: true,
      },
    });

    const aprovados = sub.payments.filter(
      (p) => p.status === PaymentStatus.APPROVED,
    );

    return {
      id: sub.id,
      usuario: {
        id: sub.user.id,
        nome: nomeDe(sub.user),
        email: sub.user.email,
        imagem: sub.user.image,
        desde: sub.user.createdAt,
      },
      plano: sub.planType,
      periodo: sub.billingPeriod,
      status: sub.status,
      estado: estadoDe(sub, agora),
      inicio: sub.startDate,
      fim: sub.endDate,
      fimDoTeste: sub.trialEndDate,
      canceladaEm: sub.cancelledAt,
      preco: sub.price,
      moeda: sub.currency,
      renovaSozinha: sub.autoRenew,
      cupom: sub.coupon,
      stripe: {
        assinatura: sub.stripeSubscriptionId,
        cliente: sub.stripeCustomerId,
      },
      totalPago: reais(aprovados.reduce((s, p) => s + p.finalAmount, 0)),
      pagamentos: sub.payments,
      historico: sub.history.map((h) => ({
        id: h.id,
        acao: h.action,
        de: h.fromPlan,
        para: h.toPlan,
        precoDe: h.fromPrice,
        precoPara: h.toPrice,
        motivo: h.reason,
        em: h.createdAt,
      })),
      outrasAssinaturas: outras,
    };
  }
}

/** O estado como a tela fala, a partir do status e das datas. */
export function estadoDe(
  sub: {
    status: SubscriptionPlanStatus;
    endDate: Date | null;
  },
  agora: Date,
): EstadoAssinatura {
  switch (sub.status) {
    case TRIAL:
      return 'teste';
    case PAST_DUE:
      return 'atraso';
    case CANCELLED:
      return sub.endDate && sub.endDate > agora ? 'vao-sair' : 'expiradas';
    case EXPIRED:
      return 'expiradas';
    case PENDING:
      return 'pendentes';
    default:
      return 'ativas';
  }
}
