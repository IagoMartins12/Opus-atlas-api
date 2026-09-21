import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingPeriod, CouponType, PlanType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PlanPricingDto,
  PricingResponseDto,
} from '../dto/pricing-response.dto';

export interface CouponDiscount {
  type: CouponType;
  discountValue: number;
  maxDiscount?: number | null;
}

export interface FinalPriceResult {
  originalPrice: number;
  discount: number;
  finalPrice: number;
}

/**
 * Preços dos planos — lidos de `PlanPricing` (editável pelo admin na Fase 4).
 *
 * Corrige uma inconsistência real do legado: `GET /pricing` já lia do banco,
 * mas o cálculo usado no checkout/coupon (`calculateFinalPrice` em
 * `subscriptionConstants.ts`) usava uma constante `PLAN_PRICES` hardcoded no
 * código — ou seja, se um admin alterasse o preço de um plano pelo painel, o
 * valor exibido na página de preços mudava, mas o valor realmente cobrado no
 * checkout continuava o antigo. Aqui os dois caminhos usam a mesma fonte.
 */
@Injectable()
export class PlanPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async getPricing(): Promise<PricingResponseDto> {
    const plans = await this.prisma.planPricing.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    const data: Record<string, PlanPricingDto> = {};

    for (const plan of plans) {
      data[plan.planType] = {
        monthly: plan.monthlyPrice,
        quarterly: this.buildPeriodPricing(
          plan.monthlyPrice,
          plan.quarterlyPrice ?? 0,
          plan.quarterlyDiscount,
          3,
        ),
        biannual: this.buildPeriodPricing(
          plan.monthlyPrice,
          plan.biannualPrice ?? 0,
          plan.biannualDiscount,
          6,
        ),
        yearly: this.buildPeriodPricing(
          plan.monthlyPrice,
          plan.yearlyPrice ?? 0,
          plan.yearlyDiscount,
          12,
        ),
        trialDays: plan.trialDays,
        description: plan.description,
      };
    }

    return { success: true, data };
  }

  /** Preço final de um plano/período, com desconto de cupom opcional —
   * fonte única também usada por `SubscriptionsService` no checkout. */
  async calculateFinalPrice(
    planType: PlanType,
    billingPeriod: BillingPeriod,
    coupon?: CouponDiscount,
  ): Promise<FinalPriceResult> {
    if (planType === 'FREE') {
      return { originalPrice: 0, discount: 0, finalPrice: 0 };
    }

    const planPricing = await this.prisma.planPricing.findFirst({
      where: { planType, isActive: true },
    });

    if (!planPricing) {
      throw new NotFoundException(
        `Preço não configurado para o plano ${planType}`,
      );
    }

    const originalPrice =
      billingPeriod === 'MONTHLY'
        ? planPricing.monthlyPrice
        : (planPricing.yearlyPrice ?? planPricing.monthlyPrice * 12);

    if (!coupon) {
      return { originalPrice, discount: 0, finalPrice: originalPrice };
    }

    let discount =
      coupon.type === 'PERCENTAGE'
        ? originalPrice * (coupon.discountValue / 100)
        : coupon.discountValue;

    if (coupon.type === 'PERCENTAGE' && coupon.maxDiscount) {
      discount = Math.min(discount, coupon.maxDiscount);
    }

    discount = Math.min(discount, originalPrice);

    return {
      originalPrice,
      discount,
      finalPrice: originalPrice - discount,
    };
  }

  private buildPeriodPricing(
    monthlyPrice: number,
    periodPrice: number,
    discount: number,
    months: number,
  ) {
    return {
      price: periodPrice,
      discount,
      monthlyEquivalent: periodPrice / months,
      savings: monthlyPrice * months - periodPrice,
    };
  }
}
