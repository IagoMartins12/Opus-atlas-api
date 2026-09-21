import { PrismaService } from '../../prisma/prisma.service';
import { CouponsService } from './coupons.service';
import { PlanPricingService } from './plan-pricing.service';

const USER = '64b000000000000000000001';
const coupon = {
  id: 'cup-1',
  code: 'PROMO20',
  type: 'PERCENTAGE',
  discountValue: 20,
  maxDiscount: null,
  maxUses: null,
  usedCount: 0,
  applicablePlans: [] as string[],
  description: 'Vinte por cento',
  extraTrialDays: 0,
};

describe('CouponsService', () => {
  let prisma: {
    coupon: { findFirst: jest.Mock };
    couponUsage: { findUnique: jest.Mock };
  };
  let pricing: { calculateFinalPrice: jest.Mock };
  let service: CouponsService;

  beforeEach(() => {
    prisma = {
      coupon: { findFirst: jest.fn().mockResolvedValue(coupon) },
      couponUsage: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    pricing = {
      calculateFinalPrice: jest
        .fn()
        .mockResolvedValue({ originalPrice: 30, discount: 6, finalPrice: 24 }),
    };
    service = new CouponsService(
      prisma as unknown as PrismaService,
      pricing as unknown as PlanPricingService,
    );
  });

  it('cupom válido mostra o preço com desconto e a economia', async () => {
    const result = await service.validate(USER, {
      code: 'promo20',
      planType: 'PLUS',
    });

    expect(prisma.coupon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'PROMO20' }),
      }),
    );
    expect(pricing.calculateFinalPrice).toHaveBeenCalledWith(
      'PLUS',
      'MONTHLY',
      {
        type: 'PERCENTAGE',
        discountValue: 20,
        maxDiscount: null,
      },
    );
    expect(result).toMatchObject({
      valid: true,
      pricing: { finalPrice: 24, savings: 6, savingsPercentage: '20.00' },
      message: 'Cupom aplicado! Você economizou 20%',
    });
  });

  it('plano de preço zero não divide por zero', async () => {
    pricing.calculateFinalPrice.mockResolvedValue({
      originalPrice: 0,
      discount: 0,
      finalPrice: 0,
    });

    const result = await service.validate(USER, {
      code: 'X',
      planType: 'PLUS',
      billingPeriod: 'YEARLY',
    });

    expect(result.pricing?.savingsPercentage).toBe('0.00');
  });

  it.each([
    [
      'inexistente ou vencido',
      () => prisma.coupon.findFirst.mockResolvedValue(null),
      'Cupom inválido ou expirado',
    ],
    [
      'já usado',
      () => prisma.couponUsage.findUnique.mockResolvedValue({ id: 'u' }),
      'Você já utilizou este cupom',
    ],
    [
      'esgotado',
      () =>
        prisma.coupon.findFirst.mockResolvedValue({
          ...coupon,
          maxUses: 3,
          usedCount: 3,
        }),
      'Cupom esgotado',
    ],
    [
      'de outro plano',
      () =>
        prisma.coupon.findFirst.mockResolvedValue({
          ...coupon,
          applicablePlans: ['MAESTRO'],
        }),
      'Cupom não aplicável a este plano',
    ],
  ])('recusa cupom %s, sem lançar', async (_label, arrange, error) => {
    arrange();

    await expect(
      service.validate(USER, { code: 'X', planType: 'PLUS' }),
    ).resolves.toEqual({ valid: false, error });
  });
});
