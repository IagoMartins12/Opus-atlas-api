import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PLANOS_PAGOS,
  StripeCatalogService,
  type EspelhoDePreco,
  type PlanoPago,
} from '../../billing/services/stripe-catalog.service';
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
  stripeCouponId: true,
  stripeSyncedAt: true,
  stripeSyncError: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Os campos que definem o desconto no Stripe; mudar um deles troca o espelho. */
const CAMPOS_DO_ESPELHO = [
  'type',
  'discountValue',
  'validUntil',
  'maxUses',
] as const;

const ehPlanoPago = (plano: string): plano is PlanoPago =>
  (PLANOS_PAGOS as readonly string[]).includes(plano);

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeCatalog: StripeCatalogService,
  ) {}

  /** O cupom como está no banco agora, com o estado do espelho. */
  private async readCoupon(couponId: string) {
    const coupon = await this.prisma.coupon.findUniqueOrThrow({
      where: { id: couponId },
      select: COUPON_SELECT,
    });

    return this.withState(coupon, new Date());
  }

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

      // O cupom nasce também no Stripe. Se o Stripe recusar, ele fica salvo
      // com o motivo em `stripeSyncError` — e o checkout tenta de novo.
      await this.stripeCatalog.syncCoupon(coupon);

      return this.readCoupon(coupon.id);
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

    // Cupom do Stripe não se edita: mudou o desconto, a validade ou o
    // limite, o espelho é trocado por outro.
    const mudouODesconto = CAMPOS_DO_ESPELHO.some(
      (campo) => dto[campo] !== undefined,
    );
    if (mudouODesconto || !coupon.stripeCouponId) {
      await this.stripeCatalog.syncCoupon(coupon, { recriar: mudouODesconto });
    }

    return this.readCoupon(coupon.id);
  }

  /** Cria (ou refaz) o espelho do cupom no Stripe, a pedido do painel. */
  async syncCoupon(couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: COUPON_SELECT,
    });

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado');
    }

    await this.stripeCatalog.syncCoupon(coupon, { recriar: true });

    return this.readCoupon(couponId);
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
      select: { id: true, usedCount: true, stripeCouponId: true },
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

    // O banco primeiro: o `coupon.deleted` que volta pelo webhook não acha
    // mais o dono e não tenta desativar nada.
    await this.prisma.coupon.delete({ where: { id: couponId } });

    if (coupon.stripeCouponId) {
      await this.stripeCatalog
        .deleteCoupon(coupon.stripeCouponId)
        .catch(() => undefined);
    }
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
   *
   * **E o preço chega ao Stripe.** Antes, a versão nova mudava a página de
   * preços e o Stripe seguia cobrando o Price ID do `.env`. Agora o valor
   * novo vira um Price novo (o antigo é arquivado; quem já assina continua
   * nele) e a versão guarda os ids que o checkout usa.
   */
  async setPricing(dto: SetPlanPricingDto) {
    const yearlyDiscount = dto.yearlyDiscount ?? 20;

    const monthly = toCents(dto.monthlyPrice);
    const yearly = toCents(monthly * 12 * (1 - yearlyDiscount / 100));

    // **O Stripe primeiro.** Se ele recusar, nada é gravado: painel dizendo
    // um preço e Stripe cobrando outro é o defeito que a sincronização
    // conserta. Sem Stripe configurado (ambiente local), grava só aqui e diz.
    const paraOStripe =
      ehPlanoPago(dto.planType) && this.stripeCatalog.isConfigured();
    const espelho: EspelhoDePreco | null =
      paraOStripe && ehPlanoPago(dto.planType)
        ? await this.stripeCatalog.pushPricing(dto.planType, {
            monthly,
            yearly,
          })
        : null;

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
          // Trimestral e semestral saíram (01/10): o Stripe só vende mensal e
          // anual, e esses dois nunca puderam ser comprados.
          quarterlyPrice: null,
          biannualPrice: null,
          quarterlyDiscount: 0,
          biannualDiscount: 0,
          yearlyPrice: yearly,
          yearlyDiscount,
          trialDays: dto.trialDays ?? 0,
          description: dto.description,
          isActive: true,
          displayOrder: dto.displayOrder ?? current?.displayOrder ?? 0,
          origin: 'painel',
          ...(espelho
            ? { ...espelho, stripeSyncedAt: new Date() }
            : {
                stripeSyncError:
                  dto.planType === 'FREE'
                    ? null
                    : 'Stripe não configurado neste ambiente.',
              }),
        },
      });
    });
  }

  /** Painel e Stripe lado a lado, plano a plano. */
  async pricingStripeStatus() {
    return this.stripeCatalog.status();
  }

  /**
   * Leva ao Stripe o preço que o painel já tem — para a versão gravada antes
   * da sincronização, ou quando o Stripe foi mexido e o painel é que vale.
   */
  async pushPricing(planType: PlanoPago) {
    const current = await this.prisma.planPricing.findFirst({
      where: { planType, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) {
      throw new NotFoundException(
        `O plano ${planType} não tem preço vigente para enviar`,
      );
    }

    const espelho = await this.stripeCatalog.pushPricing(planType, {
      monthly: current.monthlyPrice,
      yearly: current.yearlyPrice ?? toCents(current.monthlyPrice * 12),
    });

    return this.prisma.planPricing.update({
      where: { id: current.id },
      data: { ...espelho, stripeSyncedAt: new Date(), stripeSyncError: null },
    });
  }

  /** Traz para o painel o preço que está valendo no Stripe. */
  async pullPricing(planType: PlanoPago, actorId: string) {
    return this.stripeCatalog.adoptFromStripe(planType, {
      ignorarEco: true,
      actorId,
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
