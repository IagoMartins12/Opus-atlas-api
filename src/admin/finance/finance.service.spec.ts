import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
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
    payment: { findMany: jest.Mock };
    subscription: { findMany: jest.Mock; count: jest.Mock };
    teacher: { count: jest.Mock };
  };
  let fx: { rateFor: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
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
        findMany: jest.fn().mockResolvedValue([{ finalAmount: 39.9 }]),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          { price: 39.9, billingPeriod: 'MONTHLY', planType: 'MENTOR' },
          { price: 399.9, billingPeriod: 'YEARLY', planType: 'MENTOR' },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      teacher: { count: jest.fn().mockResolvedValue(2) },
    };
    fx = { rateFor: jest.fn().mockResolvedValue(5.2) };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    service = new FinanceService(
      prisma as unknown as PrismaService,
      fx as unknown as FxService,
      cache as unknown as AppCacheService,
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
        income: { subscriptionCashCents: number; manualCents: number };
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
