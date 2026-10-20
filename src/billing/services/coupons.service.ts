import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidateCouponDto } from '../dto/validate-coupon.dto';
import { CouponValidationResponseDto } from '../dto/coupon-validation-response.dto';
import { PlanPricingService } from './plan-pricing.service';

/**
 * Toda recusa de cupom diz a mesma coisa. Dizer "já usado", "esgotado" ou
 * "de outro plano" confirmava que o código existe — quem chuta códigos
 * aprendia quais são de verdade.
 */
const COUPON_INVALID = 'Cupom inválido ou expirado';

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planPricingService: PlanPricingService,
  ) {}

  async validate(
    userId: string,
    dto: ValidateCouponDto,
  ): Promise<CouponValidationResponseDto> {
    const code = dto.code.toUpperCase();
    const now = new Date();

    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code,
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
    });

    if (!coupon) {
      return { valid: false, error: COUPON_INVALID };
    }

    const usage = await this.prisma.couponUsage.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });

    if (usage) {
      return { valid: false, error: COUPON_INVALID };
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, error: COUPON_INVALID };
    }

    if (
      coupon.applicablePlans.length > 0 &&
      !coupon.applicablePlans.includes(dto.planType)
    ) {
      return { valid: false, error: COUPON_INVALID };
    }

    const { originalPrice, discount, finalPrice } =
      await this.planPricingService.calculateFinalPrice(
        dto.planType,
        dto.billingPeriod ?? 'MONTHLY',
        {
          type: coupon.type,
          discountValue: coupon.discountValue,
          maxDiscount: coupon.maxDiscount,
        },
      );

    const savingsPercentage =
      originalPrice > 0
        ? (((originalPrice - finalPrice) / originalPrice) * 100).toFixed(2)
        : '0.00';

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        discountValue: coupon.discountValue,
        description: coupon.description,
        extraTrialDays: coupon.extraTrialDays,
      },
      pricing: {
        originalPrice,
        discount,
        finalPrice,
        savings: originalPrice - finalPrice,
        savingsPercentage,
      },
      message: `Cupom aplicado! Você economizou ${Number(savingsPercentage).toFixed(0)}%`,
    };
  }
}
