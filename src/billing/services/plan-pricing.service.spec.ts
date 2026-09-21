import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanPricingService } from './plan-pricing.service';

const plus = {
  planType: 'PLUS',
  monthlyPrice: 30,
  quarterlyPrice: 81,
  quarterlyDiscount: 10,
  biannualPrice: null,
  biannualDiscount: 0,
  yearlyPrice: 300,
  yearlyDiscount: 16,
  trialDays: 7,
  description: 'Plus',
};

describe('PlanPricingService', () => {
  let prisma: { planPricing: { findMany: jest.Mock; findFirst: jest.Mock } };
  let service: PlanPricingService;

  beforeEach(() => {
    prisma = {
      planPricing: {
        findMany: jest.fn().mockResolvedValue([plus]),
        findFirst: jest.fn().mockResolvedValue(plus),
      },
    };
    service = new PlanPricingService(prisma as unknown as PrismaService);
  });

  it('tabela de preços com equivalente mensal e economia por período', async () => {
    const { data } = await service.getPricing();

    expect(data.PLUS.monthly).toBe(30);
    expect(data.PLUS.quarterly).toEqual({
      price: 81,
      discount: 10,
      monthlyEquivalent: 27,
      savings: 9,
    });
    expect(data.PLUS.yearly.savings).toBe(60);
    // Preço de período não cadastrado vira 0, não NaN.
    expect(data.PLUS.biannual.price).toBe(0);
  });

  describe('preço final', () => {
    it('gratuito é zero sem ir ao banco', async () => {
      await expect(
        service.calculateFinalPrice('FREE', 'MONTHLY'),
      ).resolves.toEqual({ originalPrice: 0, discount: 0, finalPrice: 0 });
      expect(prisma.planPricing.findFirst).not.toHaveBeenCalled();
    });

    it('mensal e anual vêm do banco — a mesma fonte da página de preços', async () => {
      await expect(
        service.calculateFinalPrice('PLUS', 'MONTHLY'),
      ).resolves.toEqual({ originalPrice: 30, discount: 0, finalPrice: 30 });
      await expect(
        service.calculateFinalPrice('PLUS', 'YEARLY'),
      ).resolves.toMatchObject({ finalPrice: 300 });
    });

    it('sem preço anual cadastrado, anual é 12 mensalidades', async () => {
      prisma.planPricing.findFirst.mockResolvedValue({
        ...plus,
        yearlyPrice: null,
      });

      await expect(
        service.calculateFinalPrice('PLUS', 'YEARLY'),
      ).resolves.toMatchObject({ originalPrice: 360 });
    });

    it('cupom percentual respeita o teto de desconto', async () => {
      await expect(
        service.calculateFinalPrice('PLUS', 'YEARLY', {
          type: 'PERCENTAGE',
          discountValue: 50,
          maxDiscount: 100,
        }),
      ).resolves.toEqual({
        originalPrice: 300,
        discount: 100,
        finalPrice: 200,
      });
    });

    it('cupom fixo não deixa o preço negativo', async () => {
      await expect(
        service.calculateFinalPrice('PLUS', 'MONTHLY', {
          type: 'FIXED',
          discountValue: 50,
        }),
      ).resolves.toEqual({ originalPrice: 30, discount: 30, finalPrice: 0 });
    });

    it('plano sem preço configurado é 404', async () => {
      prisma.planPricing.findFirst.mockResolvedValue(null);

      await expect(
        service.calculateFinalPrice('MAESTRO', 'MONTHLY'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
