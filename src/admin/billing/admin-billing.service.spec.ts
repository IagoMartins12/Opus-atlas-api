import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CouponType, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminBillingService } from './admin-billing.service';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '6.19.0',
  });

describe('AdminBillingService', () => {
  let service: AdminBillingService;
  let prisma: {
    coupon: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    couponUsage: { count: jest.Mock };
    subscription: { count: jest.Mock };
    planPricing: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    planPricing: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
  };

  const cupom = (over: Record<string, unknown> = {}) => ({
    id: 'coupon-1',
    code: 'BEMVINDO20',
    type: CouponType.PERCENTAGE,
    discountValue: 20,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2026-12-31T00:00:00.000Z'),
    maxUses: null,
    usedCount: 0,
    isActive: true,
    ...over,
  });

  const criar = {
    code: 'BEMVINDO20',
    type: CouponType.PERCENTAGE,
    discountValue: 20,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T00:00:00.000Z',
  };

  beforeEach(async () => {
    tx = {
      planPricing: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn((args: { data: unknown }) =>
          Promise.resolve(args.data),
        ),
      },
    };

    prisma = {
      coupon: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(cupom()),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { usedCount: 0 } }),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(cupom(args.data)),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(cupom(args.data)),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      couponUsage: { count: jest.fn().mockResolvedValue(0) },
      subscription: { count: jest.fn().mockResolvedValue(0) },
      planPricing: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminBillingService);
  });

  // -----------------------------------------------------------------
  describe('cupom', () => {
    // O legado gravava `parseFloat(discountValue)` sem verificação alguma.
    it('recusa desconto percentual acima de 100%', async () => {
      await expect(
        service.createCoupon({ ...criar, discountValue: 500 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('valor fixo acima de 100 é aceito — são reais, não porcentagem', async () => {
      await expect(
        service.createCoupon({
          ...criar,
          type: CouponType.FIXED,
          discountValue: 500,
        }),
      ).resolves.toBeDefined();
    });

    it('recusa validade terminando antes de começar', async () => {
      await expect(
        service.createCoupon({
          ...criar,
          validFrom: '2026-12-31T00:00:00.000Z',
          validUntil: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // No legado, `maxUses ? parseInt(maxUses) : null` fazia zero virar
    // ilimitado — o oposto do que quem digitou zero queria.
    it('`maxUses: 0` é zero, não ilimitado', async () => {
      await service.createCoupon({ ...criar, maxUses: 0 });

      expect(prisma.coupon.create.mock.calls[0][0].data.maxUses).toBe(0);
    });

    it('`maxUses` ausente é ilimitado', async () => {
      await service.createCoupon(criar);

      expect(prisma.coupon.create.mock.calls[0][0].data.maxUses).toBeNull();
    });

    it('código repetido responde 409', async () => {
      prisma.coupon.create.mockRejectedValue(p2002());

      await expect(service.createCoupon(criar)).rejects.toThrow(
        ConflictException,
      );
    });

    it('a edição revalida a combinação de tipo e valor', async () => {
      prisma.coupon.findUnique.mockResolvedValue(cupom());

      await expect(
        service.updateCoupon('coupon-1', { discountValue: 300 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------
  describe('estado derivado do cupom', () => {
    it('marca esgotado quando os usos acabaram', async () => {
      prisma.coupon.findMany.mockResolvedValue([
        cupom({ maxUses: 10, usedCount: 10 }),
      ]);

      const result = await service.listCoupons({});

      expect(result.coupons[0].isExhausted).toBe(true);
      expect(result.coupons[0].isUsable).toBe(false);
      expect(result.coupons[0].remainingUses).toBe(0);
    });

    it('cupom ilimitado não tem usos restantes definidos', async () => {
      prisma.coupon.findMany.mockResolvedValue([cupom()]);

      const result = await service.listCoupons({});

      expect(result.coupons[0].remainingUses).toBeNull();
    });

    it('marca expirado pela data final', async () => {
      prisma.coupon.findMany.mockResolvedValue([
        cupom({ validUntil: new Date('2020-01-01T00:00:00.000Z') }),
      ]);

      const result = await service.listCoupons({});

      expect(result.coupons[0].isExpired).toBe(true);
      expect(result.coupons[0].isUsable).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  describe('remoção de cupom', () => {
    // O legado fazia `include: { usages: true, subscriptions: true }` para
    // depois consultar só `usedCount`.
    it('verifica por contagem, sem carregar as relações', async () => {
      await service.deleteCoupon('coupon-1');

      expect(prisma.couponUsage.count).toHaveBeenCalledWith({
        where: { couponId: 'coupon-1' },
      });
      expect(prisma.coupon.delete).toHaveBeenCalled();
    });

    it('cupom usado não é removido', async () => {
      prisma.coupon.findUnique.mockResolvedValue(cupom({ usedCount: 5 }));

      await expect(service.deleteCoupon('coupon-1')).rejects.toThrow(
        ConflictException,
      );
    });

    // O contador pode estar defasado; a assinatura que aponta para o cupom é a
    // prova de que ele foi usado.
    it('assinatura referenciando o cupom impede a remoção', async () => {
      prisma.subscription.count.mockResolvedValue(1);

      await expect(service.deleteCoupon('coupon-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.coupon.delete).not.toHaveBeenCalled();
    });

    it('cupom inexistente responde 404', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);

      await expect(service.deleteCoupon('coupon-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('preço de plano', () => {
    // `29,90 × 3 × 0,9` dá 80.72999999999999 em ponto flutuante.
    it('arredonda os preços derivados a centavos', async () => {
      const result = (await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 29.9,
        quarterlyDiscount: 10,
      })) as { quarterlyPrice: number };

      expect(result.quarterlyPrice).toBe(80.73);
    });

    it('desconto zero mantém o múltiplo exato', async () => {
      const result = (await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 10,
        quarterlyDiscount: 0,
        biannualDiscount: 0,
        yearlyDiscount: 0,
      })) as { quarterlyPrice: number; yearlyPrice: number };

      expect(result.quarterlyPrice).toBe(30);
      expect(result.yearlyPrice).toBe(120);
    });

    it('desconto de 100% zera o preço, sem negativo', async () => {
      const result = (await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 29.9,
        yearlyDiscount: 100,
      })) as { yearlyPrice: number };

      expect(result.yearlyPrice).toBe(0);
    });

    // Manter o histórico é o que permite conferir uma fatura antiga.
    it('cria versão nova e desativa a anterior, na mesma transação', async () => {
      await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 29.9,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.planPricing.updateMany.mock.calls[0][0].data).toEqual({
        isActive: false,
      });
      expect(tx.planPricing.create.mock.calls[0][0].data.isActive).toBe(true);
    });

    it('herda a ordem de exibição da versão anterior', async () => {
      tx.planPricing.findFirst.mockResolvedValue({ displayOrder: 3 });

      await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 10,
      });

      expect(tx.planPricing.create.mock.calls[0][0].data.displayOrder).toBe(3);
    });

    it('usa os descontos padrão quando não informados', async () => {
      await service.setPricing({
        planType: PlanType.PLUS,
        monthlyPrice: 10,
      });

      const { data } = tx.planPricing.create.mock.calls[0][0];

      expect(data.quarterlyDiscount).toBe(10);
      expect(data.biannualDiscount).toBe(15);
      expect(data.yearlyDiscount).toBe(20);
    });
  });
});
