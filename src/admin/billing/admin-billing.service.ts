import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  SetPlanPricingDto,
  UpdateCouponDto,
} from './dto/admin-billing.dto';

/**
 * Arredonda um valor monetário para centavos.
 *
 * `29.9 * 3 * (1 - 0.1)` dá `80.72999999999999` em ponto flutuante. Gravar isso
 * numa tabela de preços significa cobrar um valor que não fecha com o que a
 * tela mostra. O legado gravava o resultado cru.
 */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

const COUPON_SELECT = {
  id: true,
  code: true,
  type: true,
  discountValue: true,
  maxDiscount: true,
  applicablePlans: true,
  validFrom: true,
  validUntil: true,
  maxUses: true,
  usedCount: true,
  maxUsesPerUser: true,
  extraTrialDays: true,
  isActive: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AdminBillingService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Cupons
  // -------------------------------------------------------------------

  /**
   * Lista os cupons.
   *
   * Paginada, e com as estatísticas vindas de contagens no banco. O legado
   * carregava **todos** os cupons e calculava total, ativos, expirados e usos
   * com `.filter()` e `.reduce()` em memória.
   */
  async listCoupons(query: ListCouponsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const where: Prisma.CouponWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const now = new Date();

    const [coupons, filtered, total, active, expired, usage] =
      await Promise.all([
        this.prisma.coupon.findMany({
          where,
          select: COUPON_SELECT,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.coupon.count({ where }),
        this.prisma.coupon.count(),
        this.prisma.coupon.count({ where: { isActive: true } }),
        this.prisma.coupon.count({ where: { validUntil: { lt: now } } }),
        this.prisma.coupon.aggregate({ _sum: { usedCount: true } }),
      ]);

    return {
      coupons: coupons.map((coupon) => this.withState(coupon, now)),
      stats: {
        total,
        active,
        inactive: total - active,
        expired,
        totalUsed: usage._sum.usedCount ?? 0,
      },
      pagination: {
        page,
        limit,
        total: filtered,
        totalPages: Math.ceil(filtered / limit),
      },
    };
  }

  /** Estado derivado, para a tela não recalcular vigência e esgotamento. */
  private withState<
    T extends {
      validFrom: Date;
      validUntil: Date;
      isActive: boolean;
      maxUses: number | null;
      usedCount: number;
    },
  >(coupon: T, now: Date) {
    const exhausted =
      coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses;

    return {
      ...coupon,
      isExpired: coupon.validUntil < now,
      isNotStarted: coupon.validFrom > now,
      isExhausted: exhausted,
      isUsable:
        coupon.isActive &&
        !exhausted &&
        coupon.validFrom <= now &&
        coupon.validUntil >= now,
      remainingUses:
        coupon.maxUses === null
          ? null
          : Math.max(0, coupon.maxUses - coupon.usedCount),
    };
  }

  async createCoupon(dto: CreateCouponDto) {
    this.assertCouponRules(
      dto.type,
      dto.discountValue,
      dto.validFrom,
      dto.validUntil,
    );

    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code: dto.code,
          type: dto.type,
          discountValue: dto.discountValue,
          maxDiscount: dto.maxDiscount ?? null,
          applicablePlans: dto.applicablePlans ?? [],
          validFrom: new Date(dto.validFrom),
          validUntil: new Date(dto.validUntil),
          // `?? null` em vez de `? ... : null`: zero é um limite válido, não
          // ausência de limite.
          maxUses: dto.maxUses ?? null,
          maxUsesPerUser: dto.maxUsesPerUser ?? 1,
          extraTrialDays: dto.extraTrialDays ?? null,
          description: dto.description ?? null,
          isActive: dto.isActive ?? true,
        },
        select: COUPON_SELECT,
      });

      return this.withState(coupon, new Date());
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Já existe um cupom com o código ${dto.code}`,
        );
      }

      throw error;
    }
  }

  async updateCoupon(couponId: string, dto: UpdateCouponDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const current = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: {
        id: true,
        type: true,
        discountValue: true,
        validFrom: true,
        validUntil: true,
        usedCount: true,
      },
    });

    if (!current) {
      throw new NotFoundException('Cupom não encontrado');
    }

    this.assertCouponRules(
      dto.type ?? current.type,
      dto.discountValue ?? current.discountValue,
      dto.validFrom ?? current.validFrom.toISOString(),
      dto.validUntil ?? current.validUntil.toISOString(),
    );

    const coupon = await this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        type: dto.type,
        discountValue: dto.discountValue,
        maxDiscount: dto.maxDiscount,
        applicablePlans: dto.applicablePlans,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        maxUses: dto.maxUses,
        maxUsesPerUser: dto.maxUsesPerUser,
        extraTrialDays: dto.extraTrialDays,
        description: dto.description,
        isActive: dto.isActive,
      },
      select: COUPON_SELECT,
    });

    return this.withState(coupon, new Date());
  }

  async toggleCoupon(couponId: string) {
    const current = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: { id: true, isActive: true },
    });

    if (!current) {
      throw new NotFoundException('Cupom não encontrado');
    }

    const coupon = await this.prisma.coupon.update({
      where: { id: couponId },
      data: { isActive: !current.isActive },
      select: COUPON_SELECT,
    });

    return this.withState(coupon, new Date());
  }

  /**
   * Remove um cupom nunca usado.
   *
   * **A verificação usa contagens, não a relação carregada.** O legado fazia
   * `include: { usages: true, subscriptions: true }` para depois consultar só
   * `usedCount`: um cupom com dez mil usos trazia dez mil linhas do banco para
   * ler um inteiro.
   *
   * Além de `usedCount`, agora contam as assinaturas que apontam para o cupom —
   * o contador pode estar defasado, e apagar um cupom ainda referenciado
   * quebraria o histórico de cobrança.
   */
  async deleteCoupon(couponId: string): Promise<void> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: { id: true, usedCount: true },
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado');
    }

    const [usages, subscriptions] = await Promise.all([
      this.prisma.couponUsage.count({ where: { couponId } }),
      this.prisma.subscription.count({ where: { couponId } }),
    ]);

    if (coupon.usedCount > 0 || usages > 0 || subscriptions > 0) {
      throw new ConflictException(
        'Este cupom já foi usado e não pode ser removido — o histórico de cobrança depende dele. Desative-o.',
      );
    }

    await this.prisma.coupon.delete({ where: { id: couponId } });
  }

  /**
   * Regras que dependem da combinação de campos.
   *
   * Nenhuma delas existia no legado: um cupom de 500%, com validade terminando
   * antes de começar, era aceito.
   */
  private assertCouponRules(
    type: CouponType,
    discountValue: number,
    validFrom: string,
    validUntil: string,
  ): void {
    if (type === CouponType.PERCENTAGE && discountValue > 100) {
      throw new BadRequestException(
        'Um desconto percentual não pode passar de 100%',
      );
    }

    const start = new Date(validFrom);
    const end = new Date(validUntil);

    if (end <= start) {
      throw new BadRequestException(
        'A validade final precisa ser posterior à inicial',
      );
    }
  }

  // -------------------------------------------------------------------
  // Preços de plano
  // -------------------------------------------------------------------

  async listPricing() {
    return this.prisma.planPricing.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { planType: 'asc' }],
    });
  }

  /**
   * Define o preço vigente de um plano.
   *
   * **O preço não é sobrescrito: uma versão nova é criada e a anterior é
   * desativada.** Mantém o histórico do que foi cobrado, que é o que permite
   * conferir uma fatura antiga.
   *
   * Os preços derivados são arredondados a centavos. Sem isso,
   * `29,90 × 3 × 0,9` grava `80.72999999999999` na tabela.
   */
  async setPricing(dto: SetPlanPricingDto) {
    const quarterlyDiscount = dto.quarterlyDiscount ?? 10;
    const biannualDiscount = dto.biannualDiscount ?? 15;
    const yearlyDiscount = dto.yearlyDiscount ?? 20;

    const monthly = toCents(dto.monthlyPrice);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.planPricing.findFirst({
        where: { planType: dto.planType, isActive: true },
        select: { displayOrder: true },
      });

      await tx.planPricing.updateMany({
        where: { planType: dto.planType },
        data: { isActive: false },
      });

      return tx.planPricing.create({
        data: {
          planType: dto.planType,
          monthlyPrice: monthly,
          quarterlyPrice: toCents(monthly * 3 * (1 - quarterlyDiscount / 100)),
          biannualPrice: toCents(monthly * 6 * (1 - biannualDiscount / 100)),
          yearlyPrice: toCents(monthly * 12 * (1 - yearlyDiscount / 100)),
          quarterlyDiscount,
          biannualDiscount,
          yearlyDiscount,
          trialDays: dto.trialDays ?? 0,
          description: dto.description,
          isActive: true,
          displayOrder: dto.displayOrder ?? current?.displayOrder ?? 0,
        },
      });
    });
  }

  /** Histórico de preços de um plano, do mais recente ao mais antigo. */
  async pricingHistory(planType: SetPlanPricingDto['planType']) {
    return this.prisma.planPricing.findMany({
      where: { planType },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
