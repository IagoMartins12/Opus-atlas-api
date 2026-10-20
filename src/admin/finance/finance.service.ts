import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinanceDirection,
  FinanceEntry,
  FinanceGoal,
  FinanceMetric,
  Prisma,
} from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COST_CATEGORIES,
  CreateFinanceEntryDto,
  CreateFinanceGoalDto,
  INCOME_CATEGORIES,
  UpdateFinanceEntryDto,
} from './dto/finance.dto';
import { MrrService } from '../../billing/services/mrr.service';
import { StripeService } from '../../billing/services/stripe.service';
import { FxService } from './fx.service';
import {
  breakEven,
  monthEnd,
  monthKey,
  monthlyEquivalentCents,
  monthlyRevenueCents,
  monthsFrom,
  monthStart,
  occurrencesBetween,
  type EntryShape,
} from './finance-math';

const SUMMARY_KEY = (month: string) => `admin-finance:summary:${month}`;
const SUMMARY_TTL_MS = 60 * 1000;
const PROJECTION_MONTHS = 12;

const shapeOf = (entry: FinanceEntry): EntryShape => ({
  kind: entry.kind,
  amountCents: entry.amountCents,
  fxRate: entry.fxRate,
  startDate: entry.startDate,
  installments: entry.installments,
  intervalMonths: entry.intervalMonths,
  endDate: entry.endDate,
  pausedAt: entry.pausedAt,
});

/** O que a tela mostra de um lançamento além do que está gravado. */
function present(entry: FinanceEntry, now: Date) {
  const shape = shapeOf(entry);
  const far = new Date(Date.UTC(2100, 0, 1));
  const all = occurrencesBetween(shape, new Date(0), far);
  const future = all.filter((o) => o.date > now);
  const ended =
    entry.kind === 'RECURRING'
      ? !!entry.pausedAt || (!!entry.endDate && entry.endDate <= now)
      : future.length === 0;

  return {
    id: entry.id,
    direction: entry.direction,
    name: entry.name,
    counterparty: entry.counterparty,
    category: entry.category,
    amountCents: entry.amountCents,
    currency: entry.currency,
    fxRate: entry.fxRate,
    kind: entry.kind,
    startDate: entry.startDate,
    installments: entry.installments,
    intervalMonths: entry.intervalMonths,
    endDate: entry.endDate,
    pausedAt: entry.pausedAt,
    note: entry.note,
    receiptUrl: entry.receiptUrl,
    createdAt: entry.createdAt,
    state: entry.pausedAt ? 'paused' : ended ? 'done' : 'active',
    nextDate: future[0]?.date ?? null,
    remainingInstallments: entry.kind === 'INSTALLMENTS' ? future.length : null,
    /** O que isto pesa por mês, em centavos de real (só recorrente). */
    monthlyCents: monthlyEquivalentCents(shape),
    /** Total já convertido (único e parcelado). */
    totalBrlCents:
      entry.kind === 'RECURRING'
        ? null
        : Math.round(entry.amountCents * entry.fxRate),
  };
}

/**
 * O financeiro do painel: lançamentos de custo e de entrada manual, metas, o
 * resumo do mês e a projeção. A receita de assinatura não é lançada à mão:
 * vem dos pagamentos aprovados e das assinaturas em vigor.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly cache: AppCacheService,
    private readonly mrrService: MrrService,
    private readonly stripe: StripeService,
  ) {}

  // -------------------------------------------------------------------
  // Lançamentos
  // -------------------------------------------------------------------

  async listEntries(direction: FinanceDirection) {
    const now = new Date();
    const rows = await this.prisma.financeEntry.findMany({
      where: { direction },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    });
    return { items: rows.map((row) => present(row, now)) };
  }

  async createEntry(adminId: string, dto: CreateFinanceEntryDto) {
    this.validate(dto.direction, dto);
    const { currency, fxRate } = await this.resolveFx(dto);

    const created = await this.prisma.financeEntry.create({
      data: {
        direction: dto.direction,
        name: dto.name,
        counterparty: dto.counterparty ?? null,
        category: dto.category,
        amountCents: dto.amountCents,
        currency,
        fxRate,
        kind: dto.kind,
        startDate: new Date(dto.startDate),
        installments: dto.kind === 'INSTALLMENTS' ? dto.installments : null,
        intervalMonths: dto.kind === 'RECURRING' ? dto.intervalMonths : null,
        endDate:
          dto.kind === 'RECURRING' && dto.endDate
            ? new Date(dto.endDate)
            : null,
        note: dto.note ?? null,
        receiptUrl: dto.receiptUrl ?? null,
        createdBy: adminId,
      },
    });
    await this.forgetSummaries();
    return present(created, new Date());
  }

  async updateEntry(id: string, dto: UpdateFinanceEntryDto) {
    const current = await this.requireEntry(id);
    const merged = {
      ...current,
      ...dto,
    } as unknown as CreateFinanceEntryDto & {
      direction: FinanceDirection;
    };
    merged.direction = current.direction;
    merged.startDate = dto.startDate ?? current.startDate.toISOString();
    this.validate(current.direction, merged);

    const currencyChanged =
      (dto.currency && dto.currency !== current.currency) ||
      (dto.startDate && dto.fxRate === undefined && current.currency !== 'BRL');
    const { currency, fxRate } = currencyChanged
      ? await this.resolveFx({ ...merged, fxRate: dto.fxRate })
      : { currency: current.currency, fxRate: dto.fxRate ?? current.fxRate };

    const kind = dto.kind ?? current.kind;
    const updated = await this.prisma.financeEntry.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.counterparty !== undefined
          ? { counterparty: dto.counterparty }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.amountCents !== undefined
          ? { amountCents: dto.amountCents }
          : {}),
        currency,
        fxRate,
        kind,
        ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
        installments: kind === 'INSTALLMENTS' ? merged.installments : null,
        intervalMonths: kind === 'RECURRING' ? merged.intervalMonths : null,
        endDate:
          kind === 'RECURRING' && merged.endDate
            ? new Date(merged.endDate)
            : null,
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.receiptUrl !== undefined ? { receiptUrl: dto.receiptUrl } : {}),
      },
    });
    await this.forgetSummaries();
    return present(updated, new Date());
  }

  async removeEntry(id: string): Promise<void> {
    await this.requireEntry(id);
    await this.prisma.financeEntry.delete({ where: { id } });
    await this.forgetSummaries();
  }

  /** Pausar (ou encerrar) um recorrente sem apagar o histórico. */
  async setPaused(id: string, paused: boolean) {
    const entry = await this.requireEntry(id);
    if (entry.kind !== 'RECURRING') {
      throw new BadRequestException(
        'Só lançamento recorrente se pausa. Parcelado e único se apagam.',
      );
    }
    const updated = await this.prisma.financeEntry.update({
      where: { id },
      data: { pausedAt: paused ? new Date() : null },
    });
    await this.forgetSummaries();
    return present(updated, new Date());
  }

  // -------------------------------------------------------------------
  // Metas
  // -------------------------------------------------------------------

  async listGoals() {
    const [goals, current] = await Promise.all([
      this.prisma.financeGoal.findMany({ orderBy: { deadline: 'asc' } }),
      this.currentNumbers(),
    ]);
    return { items: goals.map((goal) => this.presentGoal(goal, current)) };
  }

  async createGoal(adminId: string, dto: CreateFinanceGoalDto) {
    const goal = await this.prisma.financeGoal.create({
      data: {
        metric: dto.metric,
        target: dto.target,
        deadline: new Date(dto.deadline),
        note: dto.note ?? null,
        createdBy: adminId,
      },
    });
    return this.presentGoal(goal, await this.currentNumbers());
  }

  async removeGoal(id: string): Promise<void> {
    const found = await this.prisma.financeGoal.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Meta não encontrada');
    await this.prisma.financeGoal.delete({ where: { id } });
  }

  // -------------------------------------------------------------------
  // Resumo, projeção e exportação
  // -------------------------------------------------------------------

  async summary(month?: string) {
    const key = month ?? monthKey(new Date());
    const cached = await this.cache.get<unknown>(SUMMARY_KEY(key));
    if (cached) return cached;

    const now = new Date();
    const from = monthStart(key);
    const to = monthEnd(key);
    const entries = await this.prisma.financeEntry.findMany();
    const costs = entries.filter((e) => e.direction === 'COST');
    const incomes = entries.filter((e) => e.direction === 'INCOME');

    const inMonth = (list: FinanceEntry[]) =>
      list.flatMap((entry) =>
        occurrencesBetween(shapeOf(entry), from, to).map((o) => ({
          ...o,
          category: entry.category,
        })),
      );
    const costOcc = inMonth(costs);
    const incomeOcc = inMonth(incomes);
    const sum = (list: { brlCents: number }[]) =>
      list.reduce((total, o) => total + o.brlCents, 0);

    const [payments, subscriptions, trials, lateSubs, teachers, adjustments] =
      await Promise.all([
        this.prisma.payment.findMany({
          where: { status: 'APPROVED', paidAt: { gte: from, lt: to } },
          select: {
            finalAmount: true,
            currency: true,
            paidAt: true,
            stripeFeeCents: true,
            stripeFeeCurrency: true,
          },
        }),
        this.prisma.subscription.findMany({
          where: { status: 'ACTIVE', planType: { not: 'FREE' } },
          select: { price: true, billingPeriod: true, planType: true },
        }),
        this.prisma.subscription.count({ where: { status: 'TRIAL' } }),
        this.prisma.subscription.findMany({
          where: { status: 'PAST_DUE', planType: { not: 'FREE' } },
          select: { price: true, billingPeriod: true },
        }),
        this.prisma.teacher.count({ where: { status: 'ACTIVE' } }),
        this.prisma.paymentAdjustment.findMany({
          where: { at: { gte: from, lt: to } },
          select: { kind: true, amountCents: true, currency: true, at: true },
        }),
      ]);

    // Pagamento, taxa e ajuste em outra moeda viram reais pela PTAX do dia em
    // que o dinheiro se mexeu. Sem cotação, o valor fica de fora da soma e é
    // contado em `unconverted`: melhor avisar do que misturar moedas.
    const rates = new Map<string, Promise<number | null>>();
    let unconverted = 0;
    const brl = async (cents: number, currency: string | null, at: Date) => {
      const code = (currency ?? 'BRL').toUpperCase();
      if (code === 'BRL') return cents;
      const key = `${code}:${at.toISOString().slice(0, 10)}`;
      if (!rates.has(key)) rates.set(key, this.fx.rateFor(code, at));
      const rate = await rates.get(key);
      if (rate == null) {
        unconverted++;
        return 0;
      }
      return Math.round(cents * rate);
    };

    let subscriptionCash = 0;
    let stripeFees = 0;
    let feesPending = 0;
    for (const p of payments) {
      const at = p.paidAt ?? from;
      subscriptionCash += await brl(
        Math.round(p.finalAmount * 100),
        p.currency,
        at,
      );
      // A taxa do Stripe: só a já lida. Pagamento com valor e sem taxa lida
      // ainda não está descontado — a tela avisa, e a leitura se pede à parte.
      if (p.stripeFeeCents == null) {
        if (p.finalAmount > 0) feesPending++;
      } else {
        stripeFees += await brl(
          p.stripeFeeCents,
          p.stripeFeeCurrency ?? p.currency,
          at,
        );
      }
    }

    // Reembolso e contestação: o que saiu depois do pagamento. A contestação
    // aberta tira o valor; se for ganha, o Stripe o devolve; a tarifa fica.
    let refunds = 0;
    let disputes = 0;
    for (const a of adjustments) {
      const cents = await brl(a.amountCents, a.currency, a.at);
      if (a.kind === 'REFUND') refunds += cents;
      else if (a.kind === 'DISPUTE_WON') disputes -= cents;
      else disputes += cents;
    }
    const lateMrr = lateSubs.reduce(
      (total, s) =>
        total + monthlyRevenueCents(s.price ?? 0, s.billingPeriod ?? null),
      0,
    );
    const mrr = subscriptions.reduce(
      (total, s) =>
        total + monthlyRevenueCents(s.price ?? 0, s.billingPeriod ?? null),
      0,
    );
    const byPlan: Record<string, number> = {};
    for (const s of subscriptions) {
      byPlan[s.planType] = (byPlan[s.planType] ?? 0) + 1;
    }

    const costTotal = sum(costOcc);
    const costRealized = sum(costOcc.filter((o) => o.date <= now));
    const manualIncome = sum(incomeOcc);

    const byCategory: Record<string, number> = {};
    for (const o of costOcc) {
      byCategory[o.category] = (byCategory[o.category] ?? 0) + o.brlCents;
    }

    const fixedMonthly = costs
      .filter((e) => !e.pausedAt && (!e.endDate || e.endDate > now))
      .reduce((total, e) => total + monthlyEquivalentCents(shapeOf(e)), 0);

    const projection = monthsFrom(monthKey(now), PROJECTION_MONTHS).map((m) => {
      const start = monthStart(m);
      const end = monthEnd(m);
      const cost = costs.reduce(
        (total, e) => total + sum(occurrencesBetween(shapeOf(e), start, end)),
        0,
      );
      const manual = incomes.reduce(
        (total, e) => total + sum(occurrencesBetween(shapeOf(e), start, end)),
        0,
      );
      return {
        month: m,
        costCents: cost,
        manualIncomeCents: manual,
        subscriptionCents: mrr,
        resultCents: manual + mrr - cost,
      };
    });

    const result = {
      month: key,
      generatedAt: now.toISOString(),
      costs: {
        totalCents: costTotal,
        realizedCents: costRealized,
        plannedCents: costTotal - costRealized,
        byCategory: Object.entries(byCategory)
          .map(([category, cents]) => ({ category, cents }))
          .sort((a, b) => b.cents - a.cents),
      },
      income: {
        subscriptionCashCents: subscriptionCash,
        manualCents: manualIncome,
        grossCents: subscriptionCash + manualIncome,
        stripeFeeCents: stripeFees,
        /** Reembolsos feitos no mês (saem da receita). */
        refundsCents: refunds,
        /** Contestações: valor retirado, menos o devolvido, mais a tarifa. */
        disputesCents: disputes,
        /** Valores em moeda sem cotação, deixados de fora da soma. */
        unconverted,
        /** Pagamentos do mês com valor e sem a taxa lida: o líquido ainda não os desconta. */
        feesPending,
        /** Receita menos a taxa do Stripe (as entradas manuais não têm taxa). */
        netCents:
          subscriptionCash - stripeFees - refunds - disputes + manualIncome,
      },
      resultCents:
        subscriptionCash -
        stripeFees -
        refunds -
        disputes +
        manualIncome -
        costTotal,
      accrual: {
        // Competência: a assinatura anual vale 1/12 por mês. Só se conhece o
        // MRR de hoje, então vale para o mês atual.
        mrrCents: mrr,
        isCurrentMonth: key === monthKey(now),
      },
      subscribers: {
        active: subscriptions.length,
        byPlan,
        trial: trials,
        pastDue: lateSubs.length,
        /** O que as atrasadas valem por mês: fora do MRR, em risco. */
        pastDueMrrCents: lateMrr,
        teachers,
      },
      breakEven: breakEven(fixedMonthly, mrr, subscriptions.length),
      fixedMonthlyCostCents: fixedMonthly,
      projection,
    };
    await this.cache.set(SUMMARY_KEY(key), result, SUMMARY_TTL_MS);
    return result;
  }

  /** O MRR dos últimos meses: o fim de cada um e o que entrou, cresceu, encolheu e saiu. */
  async mrrSeries(months = 12) {
    return this.mrrService.series(months);
  }

  /**
   * Lê no Stripe a taxa dos pagamentos aprovados que ainda não a têm: os
   * anteriores a esta função, ou os que o Stripe ainda não tinha registrado
   * na hora. Em lotes, para uma chamada não demorar; chame de novo até
   * `pending` zerar.
   */
  async syncStripeFees(batch = 25) {
    const where: Prisma.PaymentWhereInput = {
      status: { in: ['APPROVED', 'REFUNDED'] },
      finalAmount: { gt: 0 },
      AND: [
        {
          // Sem a taxa, ou sem o PaymentIntent (que um reembolso ou uma
          // contestação usam para achar o pagamento).
          OR: [
            { stripeFeeCents: { isSet: false } },
            { stripeFeeCents: null },
            { stripePaymentIntentId: { isSet: false } },
            { stripePaymentIntentId: null },
          ],
        },
        {
          OR: [
            { stripeInvoiceId: { not: null } },
            { stripeSessionId: { not: null } },
          ],
        },
      ],
    };
    const rows = await this.prisma.payment.findMany({
      where,
      select: { id: true, stripeInvoiceId: true, stripeSessionId: true },
      orderBy: { createdAt: 'desc' },
      take: batch,
    });

    let updated = 0;
    for (const row of rows) {
      const fee = row.stripeInvoiceId
        ? await this.stripe.feeForInvoice(row.stripeInvoiceId)
        : row.stripeSessionId
          ? await this.stripe.feeForSession(row.stripeSessionId)
          : null;
      if (!fee) continue;
      await this.prisma.payment.update({
        where: { id: row.id },
        data: {
          stripeFeeCents: fee.feeCents,
          stripeFeeCurrency: fee.currency,
          stripePaymentIntentId: fee.paymentIntentId,
        },
      });
      updated++;
    }

    if (updated > 0) await this.forgetSummaries();
    const pending = await this.prisma.payment.count({ where });
    return { checked: rows.length, updated, pending };
  }

  /** O CSV das cobranças e entradas manuais de um período, mês a mês. */
  async exportCsv(fromMonth: string, toMonth: string): Promise<string> {
    if (fromMonth > toMonth) {
      throw new BadRequestException('O mês inicial vem depois do final.');
    }
    const from = monthStart(fromMonth);
    const to = monthEnd(toMonth);
    const entries = await this.prisma.financeEntry.findMany({
      orderBy: { startDate: 'asc' },
    });

    const rows = entries
      .flatMap((entry) =>
        occurrencesBetween(shapeOf(entry), from, to).map((o) => ({
          date: o.date.toISOString().slice(0, 10),
          direction: entry.direction === 'COST' ? 'custo' : 'entrada',
          name: entry.name,
          counterparty: entry.counterparty ?? '',
          category: entry.category,
          kind: entry.kind,
          installment: o.installment
            ? `${o.installment.n}/${o.installment.of}`
            : '',
          currency: entry.currency,
          brl: (o.brlCents / 100).toFixed(2).replace('.', ','),
        })),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const cell = (value: string) =>
      /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const header = [
      'data',
      'tipo',
      'nome',
      'fornecedor_ou_origem',
      'categoria',
      'forma',
      'parcela',
      'moeda',
      'valor_brl',
    ];
    return [
      header.join(';'),
      ...rows.map((r) =>
        [
          r.date,
          r.direction,
          r.name,
          r.counterparty,
          r.category,
          r.kind,
          r.installment,
          r.currency,
          r.brl,
        ]
          .map(cell)
          .join(';'),
      ),
    ].join('\n');
  }

  // -------------------------------------------------------------------

  private async requireEntry(id: string): Promise<FinanceEntry> {
    const entry = await this.prisma.financeEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado');
    return entry;
  }

  private validate(
    direction: FinanceDirection,
    dto: Pick<
      CreateFinanceEntryDto,
      'category' | 'kind' | 'installments' | 'intervalMonths' | 'endDate'
    > & { startDate: string },
  ) {
    const allowed: readonly string[] =
      direction === 'COST' ? COST_CATEGORIES : INCOME_CATEGORIES;
    if (!allowed.includes(dto.category)) {
      throw new BadRequestException(
        `Categoria inválida. Use: ${allowed.join(', ')}.`,
      );
    }
    if (dto.kind === 'INSTALLMENTS' && !dto.installments) {
      throw new BadRequestException('Informe o número de parcelas.');
    }
    if (dto.kind === 'RECURRING' && !dto.intervalMonths) {
      throw new BadRequestException('Informe de quantos em quantos meses.');
    }
    if (
      dto.kind === 'RECURRING' &&
      dto.endDate &&
      new Date(dto.endDate) < new Date(dto.startDate)
    ) {
      throw new BadRequestException('O fim vem antes do início.');
    }
  }

  /** A cotação: a informada, ou a PTAX do dia do lançamento. */
  private async resolveFx(
    dto: Pick<CreateFinanceEntryDto, 'currency' | 'fxRate' | 'startDate'>,
  ) {
    const currency = dto.currency ?? 'BRL';
    if (currency === 'BRL') return { currency, fxRate: 1 };
    if (dto.fxRate) return { currency, fxRate: dto.fxRate };

    const rate = await this.fx.rateFor(currency, new Date(dto.startDate));
    if (rate === null) {
      throw new BadRequestException(
        'Não foi possível buscar a cotação no Banco Central. Informe-a no lançamento.',
      );
    }
    return { currency, fxRate: rate };
  }

  private async currentNumbers() {
    const [subs, teachers] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', planType: { not: 'FREE' } },
        select: { price: true, billingPeriod: true },
      }),
      this.prisma.teacher.count({ where: { status: 'ACTIVE' } }),
    ]);
    return {
      MRR: subs.reduce(
        (t, s) =>
          t + monthlyRevenueCents(s.price ?? 0, s.billingPeriod ?? null),
        0,
      ),
      SUBSCRIBERS: subs.length,
      TEACHERS: teachers,
    } satisfies Record<FinanceMetric, number>;
  }

  private presentGoal(
    goal: FinanceGoal,
    current: Record<FinanceMetric, number>,
  ) {
    const value = current[goal.metric];
    return {
      id: goal.id,
      metric: goal.metric,
      target: goal.target,
      deadline: goal.deadline,
      note: goal.note,
      current: value,
      progress: Math.min(1, value / goal.target),
      reached: value >= goal.target,
      overdue: value < goal.target && goal.deadline < new Date(),
    };
  }

  private async forgetSummaries(): Promise<void> {
    const months = monthsFrom(
      monthKey(new Date(Date.now() - 400 * 86_400_000)),
      30,
    );
    await Promise.all(months.map((m) => this.cache.del(SUMMARY_KEY(m))));
  }
}

export type FinanceSummary = Awaited<ReturnType<FinanceService['summary']>>;
