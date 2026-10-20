import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { MrrService } from '../../billing/services/mrr.service';
import { StripeService } from '../../billing/services/stripe.service';
import { FxService } from './fx.service';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  direction: 'COST',
  name: 'Servidor',
  counterparty: 'Hetzner',
  category: 'infraestrutura',
  amountCents: 10_000,
  currency: 'BRL',
  fxRate: 1,
  kind: 'RECURRING',
  startDate: new Date('2026-11-05T12:00:00Z'),
  installments: null,
  intervalMonths: 1,
  endDate: null,
  pausedAt: null,
  note: null,
  receiptUrl: null,
  createdBy: 'a1',
  createdAt: new Date('2026-10-19'),
  updatedAt: new Date('2026-10-19'),
  ...over,
});

describe('FinanceService', () => {
  let prisma: {
    financeEntry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    financeGoal: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    payment: {
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    subscription: { findMany: jest.Mock; count: jest.Mock };
    teacher: { count: jest.Mock };
    paymentAdjustment: { findMany: jest.Mock };
  };
  let fx: { rateFor: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let stripe: {
    feeForInvoice: jest.Mock;
    feeForSession: jest.Mock;
  };
  let mrr: { series: jest.Mock };
  let service: FinanceService;

  beforeEach(() => {
    prisma = {
      financeEntry: {
        findMany: jest.fn().mockResolvedValue([entry()]),
        findUnique: jest.fn().mockResolvedValue(entry()),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(entry({ id: 'new', ...data })),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(entry(data))),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      financeGoal: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'g1' }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'g1', achievedAt: null, ...data }),
          ),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      payment: {
        // R$ 39,90 pagos; o Stripe ficou com R$ 1,98.
        findMany: jest.fn().mockResolvedValue([
          {
            finalAmount: 39.9,
            currency: 'BRL',
            paidAt: new Date('2026-11-10T12:00:00Z'),
            stripeFeeCents: 198,
            stripeFeeCurrency: 'BRL',
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          { price: 39.9, billingPeriod: 'MONTHLY', planType: 'MENTOR' },
          { price: 399.9, billingPeriod: 'YEARLY', planType: 'MENTOR' },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      teacher: { count: jest.fn().mockResolvedValue(2) },
      paymentAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // Ativas e atrasadas saem da mesma consulta, filtrada pelo estado.
    prisma.subscription.findMany.mockImplementation(
      ({ where }: { where: { status: string } }) =>
        Promise.resolve(
          where.status === 'PAST_DUE'
            ? [{ price: 19.9, billingPeriod: 'MONTHLY' }]
            : [
                { price: 39.9, billingPeriod: 'MONTHLY', planType: 'MENTOR' },
                { price: 399.9, billingPeriod: 'YEARLY', planType: 'MENTOR' },
              ],
        ),
    );
    fx = { rateFor: jest.fn().mockResolvedValue(5.2) };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    stripe = {
      feeForInvoice: jest.fn().mockResolvedValue({
        feeCents: 150,
        currency: 'BRL',
        paymentIntentId: 'pi_a',
      }),
      feeForSession: jest.fn().mockResolvedValue({
        feeCents: 90,
        currency: 'BRL',
        paymentIntentId: 'pi_b',
      }),
    };
    mrr = { series: jest.fn().mockResolvedValue({ since: null, months: [] }) };
    service = new FinanceService(
      prisma as unknown as PrismaService,
      fx as unknown as FxService,
      cache as unknown as AppCacheService,
      mrr as unknown as MrrService,
      stripe as unknown as StripeService,
    );
  });

  const dto = (over: Record<string, unknown> = {}) =>
    ({
      direction: 'COST',
      name: 'Servidor',
      category: 'infraestrutura',
      amountCents: 10_000,
      kind: 'ONCE',
      startDate: '2026-11-05',
      ...over,
    }) as never;

  describe('lançar', () => {
    it('em reais não busca cotação', async () => {
      await service.createEntry('a1', dto());

      expect(fx.rateFor).not.toHaveBeenCalled();
      const [{ data }] = prisma.financeEntry.create.mock.calls[0];
      expect(data).toMatchObject({
        currency: 'BRL',
        fxRate: 1,
        createdBy: 'a1',
      });
    });

    it('em dólar usa a PTAX do dia e guarda a cotação no lançamento', async () => {
      await service.createEntry('a1', dto({ currency: 'USD' }));

      expect(fx.rateFor).toHaveBeenCalledWith('USD', new Date('2026-11-05'));
      const [{ data }] = prisma.financeEntry.create.mock.calls[0];
      expect(data).toMatchObject({ currency: 'USD', fxRate: 5.2 });
    });

    it('a cotação informada vale mais que a da PTAX (a fatura do cartão)', async () => {
      await service.createEntry('a1', dto({ currency: 'USD', fxRate: 5.55 }));

      expect(fx.rateFor).not.toHaveBeenCalled();
      const [{ data }] = prisma.financeEntry.create.mock.calls[0];
      expect(data.fxRate).toBe(5.55);
    });

    it('sem resposta do Banco Central e sem cotação informada: pede a cotação', async () => {
      fx.rateFor.mockResolvedValue(null);

      await expect(
        service.createEntry('a1', dto({ currency: 'EUR' })),
      ).rejects.toThrow('Informe-a');
      expect(prisma.financeEntry.create).not.toHaveBeenCalled();
    });

    it('categoria de custo não vale para entrada, e vice-versa', async () => {
      await expect(
        service.createEntry('a1', dto({ direction: 'INCOME', category: 'ia' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createEntry('a1', dto({ category: 'patrocinio' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('parcelado pede parcelas; recorrente pede o intervalo', async () => {
      await expect(
        service.createEntry('a1', dto({ kind: 'INSTALLMENTS' })),
      ).rejects.toThrow('parcelas');
      await expect(
        service.createEntry('a1', dto({ kind: 'RECURRING' })),
      ).rejects.toThrow('quantos em quantos meses');
    });

    it('parcelado e único não guardam intervalo nem fim', async () => {
      await service.createEntry(
        'a1',
        dto({ kind: 'INSTALLMENTS', installments: 3, intervalMonths: 2 }),
      );

      const [{ data }] = prisma.financeEntry.create.mock.calls[0];
      expect(data).toMatchObject({ installments: 3, intervalMonths: null });
    });
  });

  describe('pausar', () => {
    it('recorrente pausa e retoma; outro tipo é 400', async () => {
      await service.setPaused('e1', true);
      expect(
        prisma.financeEntry.update.mock.calls[0][0].data.pausedAt,
      ).toBeInstanceOf(Date);

      await service.setPaused('e1', false);
      expect(
        prisma.financeEntry.update.mock.calls[1][0].data.pausedAt,
      ).toBeNull();

      prisma.financeEntry.findUnique.mockResolvedValue(entry({ kind: 'ONCE' }));
      await expect(service.setPaused('e1', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lançamento inexistente é 404', async () => {
      prisma.financeEntry.findUnique.mockResolvedValue(null);
      await expect(service.removeEntry('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resumo', () => {
    it('caixa do mês, MRR com a anual dividida por 12 e o equilíbrio', async () => {
      const result = (await service.summary('2026-11')) as {
        costs: { totalCents: number };
        income: {
          subscriptionCashCents: number;
          manualCents: number;
          stripeFeeCents: number;
          netCents: number;
          feesPending: number;
        };
        resultCents: number;
        accrual: { mrrCents: number };
        breakEven: { mrrNeededCents: number };
        projection: unknown[];
        subscribers: { active: number; trial: number; teachers: number };
      };

      expect(result.costs.totalCents).toBe(10_000);
      expect(result.income.subscriptionCashCents).toBe(3_990);
      // 39,90 mensal + 399,90 anual / 12 = 33,33
      expect(result.accrual.mrrCents).toBe(3_990 + 3_333);
      expect(result.breakEven.mrrNeededCents).toBe(10_000);
      expect(result.projection).toHaveLength(12);
      expect(result.subscribers).toMatchObject({
        active: 2,
        trial: 1,
        teachers: 2,
      });
    });

    // Receita líquida: o que o Stripe ficou é custo de cobrar, e entra na conta.
    it('desconta a taxa do Stripe: líquido e resultado', async () => {
      prisma.financeEntry.findMany.mockResolvedValue([
        entry({ kind: 'ONCE', amountCents: 1_000 }),
        entry({
          id: 'e2',
          direction: 'INCOME',
          category: 'edital',
          kind: 'ONCE',
          amountCents: 50_000,
          startDate: new Date('2026-11-20T12:00:00Z'),
        }),
      ]);

      const r = (await service.summary('2026-11')) as {
        income: {
          subscriptionCashCents: number;
          manualCents: number;
          stripeFeeCents: number;
          netCents: number;
          feesPending: number;
        };
        resultCents: number;
      };

      expect(r.income.subscriptionCashCents).toBe(3_990);
      expect(r.income.stripeFeeCents).toBe(198);
      // 39,90 − 1,98 + 500,00 de edital (sem taxa)
      expect(r.income.netCents).toBe(3_990 - 198 + 50_000);
      expect(r.income.feesPending).toBe(0);
      expect(r.resultCents).toBe(3_990 - 198 + 50_000 - 1_000);
    });

    it('pagamento sem taxa lida ainda: conta e avisa quantos faltam', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { finalAmount: 39.9, stripeFeeCents: null },
        { finalAmount: 79.9, stripeFeeCents: 400 },
        { finalAmount: 0, stripeFeeCents: null },
      ]);

      const r = (await service.summary('2026-11')) as {
        income: { stripeFeeCents: number; feesPending: number };
      };

      expect(r.income.stripeFeeCents).toBe(400);
      // O pagamento zerado (cupom, teste) não tem taxa a ler.
      expect(r.income.feesPending).toBe(1);
    });

    type Receita = {
      income: {
        subscriptionCashCents: number;
        stripeFeeCents: number;
        refundsCents: number;
        disputesCents: number;
        unconverted: number;
        netCents: number;
      };
      resultCents: number;
      subscribers: { pastDue: number; pastDueMrrCents: number };
    };

    // O que saiu depois do pagamento: sem isto a receita era só o cobrado.
    it('reembolso e contestação saem da receita; a ganha devolve o valor, a tarifa fica', async () => {
      prisma.paymentAdjustment.findMany.mockResolvedValue([
        {
          kind: 'REFUND',
          amountCents: 1_000,
          currency: 'BRL',
          at: new Date('2026-11-12'),
        },
        {
          kind: 'DISPUTE',
          amountCents: 3_990,
          currency: 'BRL',
          at: new Date('2026-11-14'),
        },
        {
          kind: 'DISPUTE_FEE',
          amountCents: 1_500,
          currency: 'BRL',
          at: new Date('2026-11-14'),
        },
        {
          kind: 'DISPUTE_WON',
          amountCents: 3_990,
          currency: 'BRL',
          at: new Date('2026-11-20'),
        },
      ]);

      const r = (await service.summary('2026-11')) as Receita;

      expect(r.income.refundsCents).toBe(1_000);
      // retirou 39,90, devolveu 39,90 e a tarifa de 15,00 ficou
      expect(r.income.disputesCents).toBe(1_500);
      expect(r.income.netCents).toBe(3_990 - 198 - 1_000 - 1_500);
    });

    it('só os ajustes do mês entram (a consulta é pelo instante em que o dinheiro se mexeu)', async () => {
      await service.summary('2026-11');

      const [{ where }] = prisma.paymentAdjustment.findMany.mock.calls[0];
      expect(where.at.gte).toEqual(new Date('2026-11-01T00:00:00.000Z'));
      expect(where.at.lt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    });

    // Pagamento e taxa em outra moeda viram reais pela PTAX do dia.
    it('pagamento e taxa em dólar são convertidos pela cotação do dia', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          finalAmount: 10,
          currency: 'USD',
          paidAt: new Date('2026-11-10T12:00:00Z'),
          stripeFeeCents: 50,
          stripeFeeCurrency: 'USD',
        },
      ]);
      fx.rateFor.mockResolvedValue(5);

      const r = (await service.summary('2026-11')) as Receita;

      expect(fx.rateFor).toHaveBeenCalledWith(
        'USD',
        new Date('2026-11-10T12:00:00Z'),
      );
      expect(r.income.subscriptionCashCents).toBe(5_000);
      expect(r.income.stripeFeeCents).toBe(250);
      expect(r.income.unconverted).toBe(0);
    });

    it('taxa em moeda diferente da do pagamento é convertida à parte', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          finalAmount: 39.9,
          currency: 'BRL',
          paidAt: new Date('2026-11-10T12:00:00Z'),
          stripeFeeCents: 100,
          stripeFeeCurrency: 'USD',
        },
      ]);
      fx.rateFor.mockResolvedValue(5);

      const r = (await service.summary('2026-11')) as Receita;

      expect(r.income.subscriptionCashCents).toBe(3_990);
      expect(r.income.stripeFeeCents).toBe(500);
    });

    it('sem cotação, o valor fica fora da soma e é contado, não misturado', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          finalAmount: 10,
          currency: 'EUR',
          paidAt: new Date('2026-11-10T12:00:00Z'),
          stripeFeeCents: null,
          stripeFeeCurrency: null,
        },
      ]);
      fx.rateFor.mockResolvedValue(null);

      const r = (await service.summary('2026-11')) as Receita;

      expect(r.income.subscriptionCashCents).toBe(0);
      expect(r.income.unconverted).toBe(1);
    });

    it('a cotação do mesmo dia é buscada uma vez só', async () => {
      const at = new Date('2026-11-10T12:00:00Z');
      prisma.payment.findMany.mockResolvedValue([
        {
          finalAmount: 10,
          currency: 'USD',
          paidAt: at,
          stripeFeeCents: 10,
          stripeFeeCurrency: 'USD',
        },
        {
          finalAmount: 20,
          currency: 'USD',
          paidAt: at,
          stripeFeeCents: 20,
          stripeFeeCurrency: 'USD',
        },
      ]);
      fx.rateFor.mockResolvedValue(5);

      await service.summary('2026-11');

      expect(fx.rateFor).toHaveBeenCalledTimes(1);
    });

    it('assinaturas atrasadas: contadas e com o valor mensal em risco, fora do MRR', async () => {
      const r = (await service.summary('2026-11')) as Receita & {
        accrual: { mrrCents: number };
      };

      expect(r.subscribers.pastDue).toBe(1);
      expect(r.subscribers.pastDueMrrCents).toBe(1_990);
      expect(r.accrual.mrrCents).toBe(3_990 + 3_333);
    });

    it('é guardado em cache e o cache vale', async () => {
      await service.summary('2026-11');
      expect(cache.set).toHaveBeenCalled();

      cache.get.mockResolvedValue({ cached: true });
      expect(await service.summary('2026-11')).toEqual({ cached: true });
    });
  });

  describe('exportação', () => {
    it('CSV com ponto e vírgula, vírgula decimal e uma linha por cobrança', async () => {
      prisma.financeEntry.findMany.mockResolvedValue([
        entry({ name: 'Servidor; "grande"' }),
      ]);

      const csv = await service.exportCsv('2026-11', '2027-01');
      const lines = csv.split('\n');

      expect(lines[0]).toContain('data;tipo;nome');
      expect(lines).toHaveLength(4); // cabeçalho + nov, dez, jan
      expect(lines[1]).toContain('"Servidor; ""grande"""');
      expect(lines[1]).toContain('100,00');
    });

    it('mês inicial depois do final é 400', async () => {
      await expect(
        service.exportCsv('2027-01', '2026-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('taxas do Stripe', () => {
    it('lê a taxa de quem não a tem, pela fatura ou pela sessão, e conta o que falta', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { id: 'p1', stripeInvoiceId: 'in_1', stripeSessionId: null },
        { id: 'p2', stripeInvoiceId: null, stripeSessionId: 'cs_1' },
        { id: 'p3', stripeInvoiceId: 'in_3', stripeSessionId: null },
      ]);
      stripe.feeForInvoice
        .mockResolvedValueOnce({
          feeCents: 150,
          currency: 'BRL',
          paymentIntentId: 'pi_a',
        })
        .mockResolvedValueOnce(null);
      prisma.payment.count.mockResolvedValue(1);

      const result = await service.syncStripeFees();

      expect(result).toEqual({ checked: 3, updated: 2, pending: 1 });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          stripeFeeCents: 150,
          stripeFeeCurrency: 'BRL',
          stripePaymentIntentId: 'pi_a',
        },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'p2' },
        data: {
          stripeFeeCents: 90,
          stripeFeeCurrency: 'BRL',
          stripePaymentIntentId: 'pi_b',
        },
      });
      expect(prisma.payment.update).toHaveBeenCalledTimes(2);
    });

    it('procura pagamento com valor, sem taxa ou sem PaymentIntent (inclusive campo ausente); o reembolsado também', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await service.syncStripeFees();

      const [{ where }] = prisma.payment.findMany.mock.calls[0];
      expect(where.status).toEqual({ in: ['APPROVED', 'REFUNDED'] });
      expect(where.finalAmount).toEqual({ gt: 0 });
      expect(JSON.stringify(where)).toContain('"isSet":false');
      // O PaymentIntent que falta também justifica uma nova leitura.
      expect(JSON.stringify(where)).toContain('stripePaymentIntentId');
    });

    it('nada para ler: nada é gravado nem o cache é limpo', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await service.syncStripeFees();

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  it('a série de MRR vem do serviço de retratos', async () => {
    await service.mrrSeries(6);

    expect(mrr.series).toHaveBeenCalledWith(6);
  });

  describe('metas', () => {
    it('progresso: MRR de hoje contra a meta', async () => {
      prisma.financeGoal.findMany.mockResolvedValue([
        {
          id: 'g1',
          metric: 'MRR',
          target: 14_646,
          deadline: new Date('2099-01-01'),
          note: null,
          achievedAt: null,
        },
      ]);

      const { items } = await service.listGoals();

      expect(items[0]).toMatchObject({
        current: 7_323,
        reached: false,
        overdue: false,
      });
      expect(items[0].progress).toBeCloseTo(0.5);
    });
  });
});
