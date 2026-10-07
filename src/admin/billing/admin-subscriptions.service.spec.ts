import { NotFoundException } from '@nestjs/common';
import { SubscriptionPlanStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminSubscriptionsService,
  estadoDe,
} from './admin-subscriptions.service';

const pessoa = (id: string) => ({
  id,
  firstName: 'Ana',
  lastName: id,
  email: `${id}@x.com`,
  image: null,
});

function montarPrisma() {
  return {
    payment: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { finalAmount: 0, discountAmount: 0 },
        _count: { _all: 0 },
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $runCommandRaw: jest.fn().mockResolvedValue({ cursor: { firstBatch: [] } }),
  };
}

describe('AdminSubscriptionsService', () => {
  let prisma: ReturnType<typeof montarPrisma>;
  let service: AdminSubscriptionsService;

  beforeEach(() => {
    prisma = montarPrisma();
    service = new AdminSubscriptionsService(prisma as unknown as PrismaService);
  });

  describe('overview', () => {
    it('recorrente mensal: anual conta por 12, e o que não tem preço é contado à parte', async () => {
      prisma.subscription.groupBy.mockImplementation(
        (args: { by: string[] }) => {
          if (args.by.length === 2) {
            return Promise.resolve([
              {
                planType: 'PLUS',
                billingPeriod: 'MONTHLY',
                _sum: { price: 59.8 },
                _count: { _all: 3, price: 2 },
              },
              {
                planType: 'MAESTRO',
                billingPeriod: 'YEARLY',
                _sum: { price: 1200 },
                _count: { _all: 1, price: 1 },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const r = await service.overview(30);

      expect(r.recorrente.mensal).toBe(159.8);
      expect(r.recorrente.anualizado).toBe(1917.6);
      expect(r.recorrente.semPreco).toBe(1);
      expect(r.recorrente.porPlano).toEqual([
        { plano: 'PLUS', mensal: 59.8 },
        { plano: 'MENTOR', mensal: 0 },
        { plano: 'MAESTRO', mensal: 100 },
      ]);
    });

    it('conta assinantes vivos por plano, período e estado', async () => {
      prisma.subscription.groupBy.mockImplementation((args: { by: string[] }) =>
        Promise.resolve(
          args.by.length === 3
            ? [
                {
                  planType: 'PLUS',
                  billingPeriod: 'MONTHLY',
                  status: 'ACTIVE',
                  _count: { _all: 4 },
                },
                {
                  planType: 'PLUS',
                  billingPeriod: 'YEARLY',
                  status: 'TRIAL',
                  _count: { _all: 2 },
                },
                {
                  planType: 'MENTOR',
                  billingPeriod: 'MONTHLY',
                  status: 'PAST_DUE',
                  _count: { _all: 1 },
                },
              ]
            : [],
        ),
      );

      const r = await service.overview(30);

      expect(r.assinantes.vivas).toBe(7);
      expect(r.assinantes.ativas).toBe(4);
      expect(r.assinantes.teste).toBe(2);
      expect(r.assinantes.atraso).toBe(1);
      expect(r.assinantes.porPlano[0]).toEqual({
        plano: 'PLUS',
        mensal: 4,
        anual: 2,
        total: 6,
      });
    });

    it('os 12 meses aparecem, com zero onde não houve pagamento', async () => {
      const agora = new Date();
      const chave = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
      prisma.$runCommandRaw.mockResolvedValue({
        cursor: { firstBatch: [{ _id: chave, valor: 99.9, pagamentos: 2 }] },
      });

      const r = await service.overview(30);

      expect(r.receita.porMes).toHaveLength(12);
      expect(r.receita.porMes[11]).toEqual({
        mes: chave,
        valor: 99.9,
        pagamentos: 2,
      });
      expect(r.receita.porMes[0].valor).toBe(0);
    });

    it('taxa de cancelamento sem base é nula, não 0%', async () => {
      const r = await service.overview(30);
      expect(r.movimento.taxaCancelamento).toEqual({ valor: null, base: 0 });
    });

    it('"não renovaram" tira quem tem plano vivo e mostra uma linha por pessoa', async () => {
      prisma.subscription.findMany.mockImplementation(
        (args: { distinct?: string[]; select?: { user?: unknown } }) => {
          if (args.distinct) return Promise.resolve([{ userId: 'viva' }]);
          if (args.select?.user) {
            return Promise.resolve([
              {
                id: 's1',
                userId: 'u1',
                planType: 'PLUS',
                billingPeriod: 'MONTHLY',
                endDate: new Date(),
                user: pessoa('u1'),
              },
              {
                id: 's0',
                userId: 'u1',
                planType: 'PLUS',
                billingPeriod: 'MONTHLY',
                endDate: new Date(0),
                user: pessoa('u1'),
              },
              {
                id: 's2',
                userId: 'u2',
                planType: 'MENTOR',
                billingPeriod: 'YEARLY',
                endDate: new Date(),
                user: pessoa('u2'),
              },
            ]);
          }
          return Promise.resolve([
            { id: 's1', userId: 'u1' },
            { id: 's0', userId: 'u1' },
            { id: 's2', userId: 'u2' },
          ]);
        },
      );
      prisma.subscription.groupBy.mockImplementation((args: { by: string[] }) =>
        Promise.resolve(
          args.by[0] === 'userId'
            ? [{ userId: 'u1' }, { userId: 'u2' }].map((x) => ({
                ...x,
                _count: { _all: 1 },
              }))
            : [],
        ),
      );
      prisma.payment.groupBy.mockImplementation((args: { by: string[] }) =>
        Promise.resolve(
          args.by[0] === 'subscriptionId'
            ? [
                { subscriptionId: 's1', _sum: { finalAmount: 29.9 } },
                { subscriptionId: 's0', _sum: { finalAmount: 29.9 } },
              ]
            : [],
        ),
      );

      const r = await service.overview(30);

      const filtro = prisma.subscription.groupBy.mock.calls.find(
        ([a]: [{ by: string[] }]) => a.by[0] === 'userId',
      )[0];
      expect(filtro.where.userId).toEqual({ notIn: ['viva'] });
      expect(r.movimento.naoRenovaram).toBe(2);
      expect(r.naoRenovaramRecentes.map((l) => l.id)).toEqual(['s1', 's2']);
      expect(r.naoRenovaramRecentes[0].totalPago).toBe(59.8);
    });
  });

  it('detalhe de assinatura que não existe é 404', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(service.detail('64f000000000000000000001')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('estadoDe: cancelada com período pago por vencer ainda "vai sair"', () => {
    const agora = new Date('2026-09-29T12:00:00Z');
    const cancelada = SubscriptionPlanStatus.CANCELLED;
    expect(
      estadoDe({ status: cancelada, endDate: new Date('2026-10-10') }, agora),
    ).toBe('vao-sair');
    expect(
      estadoDe({ status: cancelada, endDate: new Date('2026-09-01') }, agora),
    ).toBe('expiradas');
    expect(
      estadoDe(
        { status: SubscriptionPlanStatus.PAST_DUE, endDate: null },
        agora,
      ),
    ).toBe('atraso');
  });
});
