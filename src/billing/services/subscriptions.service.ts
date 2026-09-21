import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Subscription } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PLAN_FEATURES,
  PlanFeatureSet,
  TRIAL_PERIOD_DAYS,
  getFeatureLimit,
  getPlanChangeType,
  hasFeature,
} from '../constants/plan-features.constants';
import { CancelSubscriptionDto } from '../dto/cancel-subscription.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { CurrentSubscriptionResponseDto } from '../dto/current-subscription-response.dto';
import { SubscriptionActionResponseDto } from '../dto/subscription-action-response.dto';
import { UpgradeSubscriptionDto } from '../dto/upgrade-subscription.dto';
import { InvoicesService } from './invoices.service';
import { PlanPricingService } from './plan-pricing.service';
import { StripeService } from './stripe.service';

const ACTIVE_STATUSES: Subscription['status'][] = ['TRIAL', 'ACTIVE'];

/**
 * O que dá acesso ao plano: teste, ativa, e cancelada **até o fim do período
 * já pago** — é o que a mensagem de cancelamento promete ("você terá acesso
 * até…") e o que o enum documenta. `PENDING` (checkout aberto) não dá.
 */
const ACCESS_WHERE = (now: Date): Prisma.SubscriptionWhereInput => ({
  OR: [
    {
      status: { in: ACTIVE_STATUSES },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    { status: 'CANCELLED', endDate: { gte: now } },
  ],
});

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planPricingService: PlanPricingService,
    private readonly stripeService: StripeService,
    private readonly invoicesService: InvoicesService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /** Assinatura ativa (TRIAL ou ACTIVE, ainda dentro do período) do usuário —
   * exportado para outros módulos (uploads, portal) consultarem limites de
   * plano nas fases seguintes, sem duplicar esta query. */
  async getCurrentSubscription(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { userId, ...ACCESS_WHERE(new Date()) },
      orderBy: { createdAt: 'desc' },
      include: { coupon: true },
    });
  }

  /** Checa acesso a uma feature específica do plano atual — reaproveitável
   * por outros módulos (ex.: limite de upload, limite de alunos). */
  async checkFeatureAccess(userId: string, feature: keyof PlanFeatureSet) {
    const subscription = await this.getCurrentSubscription(userId);
    const plan = subscription?.planType ?? 'FREE';
    const limit = getFeatureLimit(plan, feature);

    return {
      plan,
      hasAccess: hasFeature(plan, feature),
      limit: limit !== 0 ? limit : undefined,
    };
  }

  async getCurrent(userId: string): Promise<CurrentSubscriptionResponseDto> {
    const subscription = await this.getCurrentSubscription(userId);

    const trialDaysRemaining = subscription?.trialEndDate
      ? Math.max(
          0,
          Math.ceil(
            (subscription.trialEndDate.getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    const isTrialActive = Boolean(
      subscription?.status === 'TRIAL' &&
        subscription.trialEndDate &&
        subscription.trialEndDate > new Date(),
    );

    const plan = subscription?.planType ?? 'FREE';

    const [history, recentPayments] = await Promise.all([
      this.prisma.subscriptionHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.payment.findMany({
        where: { subscription: { userId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          subscription: { select: { planType: true, billingPeriod: true } },
        },
      }),
    ]);

    return {
      success: true,
      plan: {
        type: plan,
        isValid: true,
        isTrialActive,
        trialDaysRemaining,
        expiresAt: subscription?.endDate ?? null,
        features: PLAN_FEATURES[plan],
      },
      subscription: subscription ?? null,
      history,
      recentPayments,
    };
  }

  async create(
    userId: string,
    userEmail: string,
    userName: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    const existing = await this.getCurrentSubscription(userId);
    if (existing) {
      throw new BadRequestException('Você já possui uma assinatura ativa');
    }

    if (dto.planType !== 'FREE' && !dto.billingPeriod) {
      throw new BadRequestException(
        'Período de cobrança obrigatório para planos pagos',
      );
    }

    const now = new Date();

    if (dto.planType === 'FREE') {
      const subscription = await this.prisma.subscription.create({
        data: {
          userId,
          planType: 'FREE',
          status: 'ACTIVE',
          startDate: now,
          price: 0,
          autoRenew: false,
        },
      });

      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          userId,
          action: 'CREATED',
          toPlan: 'FREE',
          reason: 'Criação de conta',
        },
      });

      await this.updateUserPlanCache(userId);

      return {
        success: true,
        message: 'Assinatura gratuita criada com sucesso',
        subscription,
      };
    }

    const coupon = dto.couponCode
      ? await this.findValidCoupon(dto.couponCode, userId, dto.planType)
      : null;

    const { finalPrice, discount } =
      await this.planPricingService.calculateFinalPrice(
        dto.planType,
        dto.billingPeriod!,
        coupon
          ? {
              type: coupon.type,
              discountValue: coupon.discountValue,
              maxDiscount: coupon.maxDiscount,
            }
          : undefined,
      );

    // Teste grátis é um por pessoa: sem isto, deixar o teste expirar e assinar
    // de novo dava outro teste, indefinidamente.
    const hadPaidPlan =
      (await this.prisma.subscription.count({
        where: { userId, planType: { not: 'FREE' } },
      })) > 0;
    const trialDays = hadPaidPlan ? 0 : TRIAL_PERIOD_DAYS[dto.planType];
    const trialEndDate =
      trialDays > 0
        ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    const frontendBaseUrl = this.getFrontendBaseUrl();
    const checkoutSession = await this.stripeService.createCheckoutSession({
      userId,
      userEmail,
      planType: dto.planType,
      billingPeriod: dto.billingPeriod!,
      successUrl: `${frontendBaseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendBaseUrl}/pricing`,
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        planType: dto.planType,
        billingPeriod: dto.billingPeriod,
        // Sem teste, a assinatura espera o pagamento sem dar acesso ao plano.
        status: trialEndDate ? 'TRIAL' : 'PENDING',
        startDate: now,
        trialEndDate,
        price: finalPrice,
        autoRenew: true,
        stripeSessionId: checkoutSession.id,
        stripeCheckoutUrl: checkoutSession.url,
        couponId: coupon?.id,
        ...(coupon ? { metadata: { couponDiscount: discount } } : {}),
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId,
        action: 'CREATED',
        toPlan: dto.planType,
        toPrice: finalPrice,
        reason: trialEndDate
          ? 'Iniciando período de teste'
          : 'Assinatura criada',
      },
    });

    // O cupom só é consumido quando o pagamento confirma
    // (`confirmCheckoutSession`): antes, checkout abandonado queimava o cupom
    // de uso único da pessoa e contava no limite do cupom.

    return {
      success: true,
      message: trialEndDate
        ? `Período de teste de ${trialDays} dias iniciado!`
        : 'Redirecionando para o checkout seguro...',
      subscription,
      payment: {
        sessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url!,
      },
    };
  }

  /**
   * Ativa uma assinatura a partir de uma sessão de checkout do Stripe já paga
   * — chamado tanto pelo endpoint de retorno (`GET /stripe/success`) quanto
   * pelo webhook (`checkout.session.completed`). Idempotente: se já existe um
   * `Payment` para esta sessão, não faz nada (evita duplicar cobrança
   * registrada quando os dois caminhos disparam para o mesmo checkout — bug
   * presente em parte do legado, que só tinha essa checagem em uma das três
   * implementações de webhook).
   */
  async confirmCheckoutSession(sessionId: string): Promise<void> {
    const existingPayment = await this.prisma.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });
    if (existingPayment) {
      this.logger.debug(`Checkout ${sessionId} já confirmado, ignorando`);
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSessionId: sessionId },
      include: { user: true },
    });

    if (!subscription) {
      this.logger.warn(`Assinatura não encontrada para sessão ${sessionId}`);
      return;
    }

    const session = await this.stripeService.retrieveCheckoutSession(sessionId);
    if (session.payment_status !== 'paid') {
      this.logger.warn(
        `Sessão ${sessionId} ainda não paga (${session.payment_status})`,
      );
      return;
    }

    const now = new Date();
    const endDate =
      subscription.billingPeriod === 'YEARLY'
        ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        startDate: now,
        endDate,
        stripeSubscriptionId:
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id,
        stripeCustomerId:
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id,
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        stripeSessionId: session.id,
        amount: (session.amount_total ?? 0) / 100,
        finalAmount: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? 'brl').toUpperCase(),
        status: 'APPROVED',
        paymentMethod: 'CREDIT_CARD',
        payerEmail: session.customer_email ?? subscription.user.email,
        paidAt: now,
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        action: 'RENEWED',
        toPlan: subscription.planType,
        toPrice: subscription.price,
        reason: 'Pagamento confirmado via Stripe',
      },
    });

    await this.invoicesService.createFromPayment(subscription.id, payment.id);

    if (subscription.couponId) {
      await this.consumeCoupon(
        subscription.couponId,
        subscription.userId,
        (subscription.metadata as { couponDiscount?: number } | null)
          ?.couponDiscount ?? 0,
      );
    }

    // Se esta assinatura é resultado de um upgrade, só agora (com o pagamento
    // já confirmado) a assinatura anterior é cancelada — ao contrário do
    // legado, que cancelava o plano antigo no mesmo instante em que o
    // checkout era criado, deixando o usuário sem nenhum plano pago caso o
    // checkout fosse abandonado.
    const metadata = subscription.metadata as {
      replacesSubscriptionId?: string;
    } | null;
    if (metadata?.replacesSubscriptionId) {
      await this.prisma.subscription.updateMany({
        where: {
          id: metadata.replacesSubscriptionId,
          status: { in: ACTIVE_STATUSES },
        },
        data: { status: 'CANCELLED', cancelledAt: now, autoRenew: false },
      });
    }

    await this.updateUserPlanCache(subscription.userId);

    if (subscription.user.email) {
      await this.mailService.sendPaymentApprovedEmail(subscription.user.email, {
        firstName: subscription.user.firstName ?? 'Usuário',
        planType: subscription.planType,
        billingPeriod: subscription.billingPeriod ?? undefined,
        amount: payment.finalAmount,
      });
    }
  }

  async cancel(
    userId: string,
    dto: CancelSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const subscription = await this.getCurrentSubscription(userId);

    if (!subscription) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada');
    }

    if (subscription.planType === 'FREE') {
      throw new BadRequestException('Plano gratuito não pode ser cancelado');
    }

    if (subscription.status === 'CANCELLED') {
      throw new BadRequestException(
        'Assinatura já cancelada — o acesso continua até o fim do período pago',
      );
    }

    const now = new Date();
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        autoRenew: false,
        metadata: {
          ...((subscription.metadata as Prisma.JsonObject) ?? {}),
          cancelReason: dto.reason ?? 'Não informado',
          cancelFeedback: dto.feedback ?? null,
          cancelledBy: 'user',
        },
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId,
        action: 'CANCELLED',
        fromPlan: subscription.planType,
        toPlan: 'FREE',
        fromPrice: subscription.price,
        toPrice: 0,
        reason: dto.reason ?? 'Cancelamento solicitado pelo usuário',
      },
    });

    // Teste cancelado (sem período pago) perde o plano na hora; assinatura paga
    // mantém até `endDate`. O cache do plano no usuário acompanha.
    await this.updateUserPlanCache(userId);

    if (user.email) {
      await this.mailService.sendSubscriptionCancelledEmail(user.email, {
        firstName: user.firstName ?? 'Usuário',
        planType: subscription.planType,
      });
    }

    return {
      success: true,
      message: subscription.endDate
        ? `Assinatura cancelada. Você terá acesso até ${subscription.endDate.toLocaleDateString('pt-BR')}`
        : 'Assinatura cancelada com sucesso',
      subscription: updated,
      accessUntil: subscription.endDate ?? now,
    };
  }

  async reactivate(userId: string): Promise<SubscriptionActionResponseDto> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: 'CANCELLED', endDate: { gte: new Date() } },
      orderBy: { cancelledAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException(
        'Nenhuma assinatura cancelada encontrada ou já expirou',
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        cancelledAt: null,
        autoRenew: true,
        metadata: {
          ...((subscription.metadata as Prisma.JsonObject) ?? {}),
          reactivatedAt: new Date().toISOString(),
          reactivatedBy: 'user',
        },
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId,
        action: 'REACTIVATED',
        toPlan: subscription.planType,
        toPrice: subscription.price,
        reason: 'Reativação pelo usuário',
      },
    });

    await this.updateUserPlanCache(userId);

    return {
      success: true,
      message: 'Assinatura reativada com sucesso!',
      subscription: updated,
    };
  }

  async upgrade(
    userId: string,
    userEmail: string,
    dto: UpgradeSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    const current = await this.getCurrentSubscription(userId);
    if (!current) {
      throw new NotFoundException('Nenhuma assinatura ativa encontrada');
    }

    const changeType = getPlanChangeType(current.planType, dto.newPlanType);
    if (changeType === 'SAME') {
      throw new BadRequestException('Você já está neste plano');
    }

    const { finalPrice } = await this.planPricingService.calculateFinalPrice(
      dto.newPlanType,
      dto.billingPeriod ?? current.billingPeriod ?? 'MONTHLY',
    );

    if (changeType === 'DOWNGRADE') {
      await this.prisma.subscription.update({
        where: { id: current.id },
        data: {
          autoRenew: false,
          metadata: {
            ...((current.metadata as Prisma.JsonObject) ?? {}),
            pendingDowngrade: dto.newPlanType,
          },
        },
      });

      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: current.id,
          userId,
          action: 'DOWNGRADED',
          fromPlan: current.planType,
          toPlan: dto.newPlanType,
          fromPrice: current.price,
          toPrice: finalPrice,
          reason: `Downgrade agendado para ${current.endDate?.toLocaleDateString('pt-BR') ?? 'o fim do ciclo'}`,
        },
      });

      return {
        success: true,
        message: `Downgrade agendado. Você continuará no plano ${current.planType} até o fim do ciclo atual.`,
        subscription: current,
      };
    }

    const frontendBaseUrl = this.getFrontendBaseUrl();
    const checkoutSession = await this.stripeService.createCheckoutSession({
      userId,
      userEmail,
      planType: dto.newPlanType,
      billingPeriod: dto.billingPeriod ?? 'MONTHLY',
      successUrl: `${frontendBaseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendBaseUrl}/pricing`,
    });

    const newSubscription = await this.prisma.subscription.create({
      data: {
        userId,
        planType: dto.newPlanType,
        billingPeriod: dto.billingPeriod ?? 'MONTHLY',
        // Era `TRIAL` sem data de fim de teste: a consulta do plano atual pega
        // a mais recente, e o cron só expira teste com data vencida — quem
        // abria o checkout do upgrade e desistia ficava no plano novo, de graça,
        // para sempre. Só vira `ACTIVE` quando o pagamento confirma.
        status: 'PENDING',
        price: finalPrice,
        autoRenew: true,
        stripeSessionId: checkoutSession.id,
        stripeCheckoutUrl: checkoutSession.url,
        metadata: { replacesSubscriptionId: current.id },
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: newSubscription.id,
        userId,
        action: 'UPGRADED',
        fromPlan: current.planType,
        toPlan: dto.newPlanType,
        fromPrice: current.price,
        toPrice: finalPrice,
        reason: 'Upgrade via Stripe (efetivado após confirmação do pagamento)',
      },
    });

    return {
      success: true,
      message: 'Redirecionando para pagamento do upgrade...',
      subscription: newSubscription,
      payment: {
        sessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url!,
      },
    };
  }

  async updateUserPlanCache(userId: string): Promise<void> {
    const subscription = await this.getCurrentSubscription(userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        currentPlan: subscription?.planType ?? 'FREE',
        planExpiresAt: subscription?.endDate,
        isTrialActive: Boolean(
          subscription?.status === 'TRIAL' &&
            subscription.trialEndDate &&
            subscription.trialEndDate > new Date(),
        ),
      },
    });
  }

  /** Registra o uso do cupom — idempotente, porque retorno e webhook confirmam
   * o mesmo checkout. */
  private async consumeCoupon(
    couponId: string,
    userId: string,
    discount: number,
  ): Promise<void> {
    try {
      await this.prisma.couponUsage.create({
        data: { couponId, userId, discountApplied: discount },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }

    await this.prisma.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
  }

  private async findValidCoupon(
    code: string,
    userId: string,
    planType: CreateSubscriptionDto['planType'],
  ) {
    const now = new Date();
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        code: code.toUpperCase(),
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
    });

    if (!coupon) {
      throw new BadRequestException('Cupom inválido ou expirado');
    }

    const usage = await this.prisma.couponUsage.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (usage) {
      throw new BadRequestException('Você já utilizou este cupom');
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('Cupom esgotado');
    }

    if (
      coupon.applicablePlans.length > 0 &&
      !coupon.applicablePlans.includes(planType)
    ) {
      throw new BadRequestException('Cupom não aplicável a este plano');
    }

    return coupon;
  }

  private getFrontendBaseUrl(): string {
    return this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }
}
