import { PrismaService } from '../../prisma/prisma.service';
import { MrrService } from './mrr.service';

const snap = (day: string, subs: Record<string, number>) => ({
  day,
  mrrCents: Object.values(subs).reduce((t, c) => t + c, 0),
  active: Object.keys(subs).length,
  subs,
});

describe('MrrService', () => {
  let prisma: {
    subscription: { findMany: jest.Mock; count: jest.Mock };
    teacher: { count: jest.Mock };
    mrrSnapshot: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let service: MrrService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-15T12:00:00Z'));
    prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            price: 39.9,
            billingPeriod: 'MONTHLY',
            planType: 'MENTOR',
          },
          {
            id: 's2',
            price: 399.9,
            billingPeriod: 'YEARLY',
            planType: 'MENTOR',
          },
          { id: 's3', price: 19.9, billingPeriod: 'MONTHLY', planType: 'PLUS' },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      teacher: { count: jest.fn().mockResolvedValue(2) },
      mrrSnapshot: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve(create)),
        findUnique: jest.fn().mockResolvedValue({ day: '2026-12-15' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new MrrService(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.useRealTimers());

  describe('retrato do dia', () => {
    it('guarda o total, o valor de cada assinatura (a anual vale 1/12) e os contadores', async () => {
      await service.takeSnapshot();

      expect(prisma.mrrSnapshot.upsert).toHaveBeenCalledWith({
        where: { day: '2026-12-15' },
        create: expect.objectContaining({
          day: '2026-12-15',
          mrrCents: 3_990 + 3_333 + 1_990,
          active: 3,
          trial: 1,
          pastDue: 1,
          teachers: 2,
          byPlan: { MENTOR: 2, PLUS: 1 },
          subs: { s1: 3_990, s2: 3_333, s3: 1_990 },
        }),
        update: expect.any(Object),
      });
    });

    it('só assinatura ativa e paga entra', async () => {
      await service.takeSnapshot();

      const [{ where }] = prisma.subscription.findMany.mock.calls[0];
      expect(where).toEqual({ status: 'ACTIVE', planType: { not: 'FREE' } });
    });

    it('já tem o de hoje: não tira outro; não tem: tira', async () => {
      await service.ensureToday();
      expect(prisma.mrrSnapshot.upsert).not.toHaveBeenCalled();

      prisma.mrrSnapshot.findUnique.mockResolvedValue(null);
      await service.ensureToday();
      expect(prisma.mrrSnapshot.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('série mensal', () => {
    it('cada mês fecha com o último retrato dele, e a ponte compara com o mês anterior', async () => {
      prisma.mrrSnapshot.findMany.mockResolvedValue([
        snap('2026-10-20', { a: 3_990 }),
        snap('2026-10-31', { a: 3_990, b: 3_990 }),
        snap('2026-11-30', { a: 7_990, c: 1_990 }), // a subiu, b saiu, c entrou
        snap('2026-12-15', { a: 7_990, c: 1_990 }),
      ]);
      prisma.mrrSnapshot.findFirst.mockResolvedValue({ day: '2026-10-20' });

      const { since, months } = await service.series(3);

      expect(since).toBe('2026-10-20');
      expect(months.map((m) => m.month)).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
      ]);

      const [oct, nov, dec] = months;
      // O primeiro mês com retrato parte do zero: tudo é novo.
      expect(oct).toMatchObject({
        mrrCents: 7_980,
        newCents: 7_980,
        active: 2,
      });
      expect(nov).toMatchObject({
        mrrCents: 9_980,
        newCents: 1_990,
        expansionCents: 4_000,
        churnCents: 3_990,
        netNewCents: 1_990 + 4_000 - 3_990,
      });
      expect(nov.churnRate).toBeCloseTo(3_990 / 7_980);
      expect(dec).toMatchObject({ mrrCents: 9_980, netNewCents: 0 });
    });

    it('a ponte fecha: a diferença entre os fins de mês é o líquido', async () => {
      prisma.mrrSnapshot.findMany.mockResolvedValue([
        snap('2026-11-30', { a: 3_990, b: 7_990 }),
        snap('2026-12-15', { a: 3_990, c: 2_500 }),
      ]);

      const { months } = await service.series(2);
      const [nov, dec] = months;

      expect(dec.mrrCents! - nov.mrrCents!).toBe(dec.netNewCents);
    });

    it('mês sem retrato fica sem número, e o seguinte compara com o último que existe', async () => {
      prisma.mrrSnapshot.findMany.mockResolvedValue([
        snap('2026-10-31', { a: 3_990 }),
        snap('2026-12-15', { a: 3_990, b: 1_000 }),
      ]);

      const { months } = await service.series(3);
      const [oct, nov, dec] = months;

      expect(oct.mrrCents).toBe(3_990);
      expect(nov).toMatchObject({
        mrrCents: null,
        active: null,
        netNewCents: 0,
      });
      expect(dec).toMatchObject({ mrrCents: 4_990, newCents: 1_000 });
    });

    it('pede o retrato de hoje antes de montar a série', async () => {
      prisma.mrrSnapshot.findUnique.mockResolvedValue(null);

      await service.series(2);

      expect(prisma.mrrSnapshot.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
