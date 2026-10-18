import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanType, Prisma, Subscription, TeacherStatus } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
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
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeService } from './stripe.service';

/**
 * Toda recusa de cupom diz a mesma coisa. Dizer "já usado", "esgotado" ou
 * "de outro plano" confirmava que o código existe — quem chuta códigos
 * aprendia quais são de verdade.
 */
const COUPON_INVALID = 'Cupom inválido ou expirado';

const ACTIVE_STATUSES: Subscription['status'][] = ['TRIAL', 'ACTIVE'];

/** Os planos para professores: assiná-los faz da conta um professor. */
export const TEACHER_PLANS: PlanType[] = ['MENTOR', 'MAESTRO'];

/**
 * Dias entre a cobrança recusada e o encerramento da assinatura. Nesse prazo a
 * pessoa é avisada, mantém o acesso e pode trocar o cartão no portal do
 * Stripe — que também tenta cobrar de novo. Sem solução, o cron encerra
 * (`SubscriptionsCronService.expireSubscriptions`).
 */
export const PAYMENT_GRACE_DAYS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * O que dá acesso ao plano: teste, ativa, cancelada **até o fim do período
 * já pago** — é o que a mensagem de cancelamento promete ("você terá acesso
 * até…") — e atrasada **até o fim do prazo para trocar o cartão**
 * (`PAYMENT_GRACE_DAYS`). `PENDING` (checkout aberto) não dá.
 */
const ACCESS_WHERE = (now: Date): Prisma.SubscriptionWhereInput => ({
  OR: [
    {
      status: { in: ACTIVE_STATUSES },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    { status: { in: ['CANCELLED', 'PAST_DUE'] }, endDate: { gte: now } },
  ],
});

type SubscriptionMetadata = {
  couponDiscount?: number;
  trialDays?: number;
  replacesSubscriptionId?: string;
  pendingDowngrade?: PlanType;
  paymentFailedAt?: string;
  origin?: string;
} & Prisma.JsonObject;

const metadataOf = (subscription: { metadata: Prisma.JsonValue | null }) =>
  (subscription.metadata as SubscriptionMetadata | null) ?? {};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planPricingService: PlanPricingService,
    private readonly stripeService: StripeService,
    private readonly stripeCatalog: StripeCatalogService,
    private readonly invoicesService: InvoicesService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly cache: AppCacheService,
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

    const { finalPrice, discount, originalPrice } =
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
    // de novo dava outro teste, indefinidamente. Conta só o que chegou a
    // valer — checkout abandonado (PENDING → EXPIRED sem Stripe) não gasta o
    // teste de ninguém.
    const hadPaidPlan =
      (await this.prisma.subscription.count({
        where: {
          userId,
          planType: { not: 'FREE' },
          stripeSubscriptionId: { not: null },
        },
      })) > 0;
    const trialDays = hadPaidPlan ? 0 : TRIAL_PERIOD_DAYS[dto.planType];

    const frontendBaseUrl = this.getFrontendBaseUrl();
    const checkoutSession = await this.stripeService.createCheckoutSession({
      userId,
      userEmail,
      planType: dto.planType,
      billingPeriod: dto.billingPeriod!,
      successUrl: `${frontendBaseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendBaseUrl}/pricing`,
      priceId: await this.stripeCatalog.priceIdFor(
        dto.planType,
        dto.billingPeriod!,
      ),
      // O cupom vai na sessão: antes ele só existia no nosso banco, a tela
      // dizia "cupom aplicado" e o Stripe cobrava o preço cheio.
      stripeCouponId: coupon
        ? await this.stripeCatalog.checkoutCouponId(
            coupon,
            originalPrice,
            discount,
          )
        : null,
      trialDays,
      customerId: await this.stripeCustomerIdOf(userId),
    });

    const metadata: SubscriptionMetadata = {};
    if (coupon) metadata.couponDiscount = discount;
    if (trialDays > 0) metadata.trialDays = trialDays;

    // Com ou sem teste, nada vale antes de o checkout terminar: o teste é do
    // Stripe e começa quando o cartão é aceito (`confirmCheckoutSession`).
    // Antes, o teste começava ao **abrir** o checkout — quem desistia ficava
    // com o plano, e quem seguia era cobrado na hora.
    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        planType: dto.planType,
        billingPeriod: dto.billingPeriod,
        status: 'PENDING',
        startDate: now,
        price: finalPrice,
        autoRenew: true,
        stripeSessionId: checkoutSession.id,
        stripeCheckoutUrl: checkoutSession.url,
        couponId: coupon?.id,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId,
        action: 'CREATED',
        toPlan: dto.planType,
        toPrice: finalPrice,
        reason:
          trialDays > 0
            ? `Checkout aberto com teste de ${trialDays} dias`
            : 'Assinatura criada',
      },
    });

    // O cupom só é consumido quando o checkout termina
    // (`confirmCheckoutSession`): antes, checkout abandonado queimava o cupom
    // de uso único da pessoa e contava no limite do cupom.

    return {
      success: true,
      message: 'Redirecionando para o checkout seguro...',
      subscription,
      payment: {
        sessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url!,
      },
    };
  }

  /**
   * Ativa uma assinatura a partir de uma sessão de checkout do Stripe concluída
   * — chamado tanto pelo endpoint de retorno (`GET /stripe/success`) quanto
   * pelo webhook (`checkout.session.completed`).
   *
   * **Dois desfechos.** Paga: ativa e registra o pagamento. Com teste
   * (`no_payment_required`, a assinatura do Stripe em `trialing`): o teste
   * começa agora, com o cartão já aceito, e a primeira cobrança é a fatura do
   * fim do teste (`registerRenewal`, ou `registerPaymentFailure` se o cartão
   * for recusado).
   *
   * Idempotente: só quem tira a assinatura de `PENDING` segue — retorno e
   * webhook disparam para o mesmo checkout, às vezes ao mesmo tempo, e a
   * troca de estado condicionada é resolvida pelo banco.
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

    if (subscription.status !== 'PENDING') {
      this.logger.debug(`Checkout ${sessionId} já confirmado, ignorando`);
      return;
    }

    const session = await this.stripeService.retrieveCheckoutSession(sessionId);
    const stripeSubscription =
      typeof session.subscription === 'string' ? null : session.subscription;
    const trialEnd = stripeSubscription?.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : null;
    const trialing =
      session.payment_status === 'no_payment_required' &&
      stripeSubscription?.status === 'trialing' &&
      trialEnd !== null;

    if (session.payment_status !== 'paid' && !trialing) {
      this.logger.warn(
        `Sessão ${sessionId} ainda não paga (${session.payment_status})`,
      );
      return;
    }

    const now = new Date();
    const endDate = trialing
      ? trialEnd
      : new Date(
          now.getTime() +
            (subscription.billingPeriod === 'YEARLY' ? 365 : 30) * DAY_MS,
        );

    const { count } = await this.prisma.subscription.updateMany({
      where: { id: subscription.id, status: 'PENDING' },
      data: {
        status: trialing ? 'TRIAL' : 'ACTIVE',
        startDate: now,
        endDate,
        trialEndDate: trialing ? trialEnd : null,
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
    if (count === 0) {
      this.logger.debug(`Checkout ${sessionId} confirmado em paralelo`);
      return;
    }

    if (subscription.couponId) {
      await this.consumeCoupon(
        subscription.couponId,
        subscription.userId,
        metadataOf(subscription).couponDiscount ?? 0,
      );
    }

    await this.replacePreviousSubscription(subscription, now);
    await this.updateUserPlanCache(subscription.userId);
    await this.activateTeacherForPlan(
      subscription.userId,
      subscription.planType,
    );

    if (trialing) {
      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          action: 'TRIAL_STARTED',
          toPlan: subscription.planType,
          toPrice: subscription.price,
          reason: `Teste até ${trialEnd.toISOString().slice(0, 10)}, cartão aceito pelo Stripe`,
        },
      });

      if (subscription.user.email) {
        await this.mailService.sendTrialStartedEmail(subscription.user.email, {
          firstName: subscription.user.firstName ?? 'Usuário',
          planType: subscription.planType,
          chargeDate: trialEnd,
          amount: subscription.price ?? 0,
        });
      }
      return;
    }

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

    if (subscription.user.email) {
      await this.mailService.sendPaymentApprovedEmail(subscription.user.email, {
        firstName: subscription.user.firstName ?? 'Usuário',
        planType: subscription.planType,
        billingPeriod: subscription.billingPeriod ?? undefined,
        amount: payment.finalAmount,
      });
    }
  }

  /**
   * Se esta assinatura é resultado de um upgrade, só agora (com o checkout
   * concluído) a anterior é encerrada — o legado a cancelava ao **abrir** o
   * checkout, e quem desistia ficava sem plano nenhum.
   *
   * **E encerrada também no Stripe.** Antes, ela só mudava aqui: a assinatura
   * antiga seguia viva no Stripe, e quem subia de plano pagava as duas.
   */
  private async replacePreviousSubscription(
    subscription: { metadata: Prisma.JsonValue | null },
    now: Date,
  ): Promise<void> {
    const previousId = metadataOf(subscription).replacesSubscriptionId;
    if (!previousId) return;

    const previous = await this.prisma.subscription.findFirst({
      where: {
        id: previousId,
        status: { in: [...ACTIVE_STATUSES, 'PAST_DUE'] },
      },
    });
    if (!previous) return;

    if (previous.stripeSubscriptionId) {
      await this.stripeService.cancelSubscriptionNow(
        previous.stripeSubscriptionId,
      );
    }
    await this.prisma.subscription.update({
      where: { id: previous.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        endDate: now,
        autoRenew: false,
      },
    });
  }

  /**
   * Cobrança recusada — no fim do teste (cartão inválido, sem saldo) ou numa
   * renovação. **A primeira recusa abre o prazo**: a assinatura fica atrasada,
   * mantém o acesso por `PAYMENT_GRACE_DAYS` e a pessoa recebe um e-mail
   * dizendo o que fazer e até quando. As tentativas seguintes do Stripe não
   * esticam o prazo. Paga no prazo, `registerRenewal` devolve a ativa; sem
   * solução, o cron encerra aqui e no Stripe.
   */
  async registerPaymentFailure(invoice: {
    stripeSubscriptionId: string;
    amountDue: number;
    currency: string;
  }): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: invoice.stripeSubscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      this.logger.warn(
        `Cobrança recusada sem assinatura conhecida (stripeSubscriptionId=${invoice.stripeSubscriptionId})`,
      );
      return;
    }

    await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: invoice.amountDue,
        finalAmount: invoice.amountDue,
        currency: invoice.currency.toUpperCase(),
        status: 'REJECTED',
      },
    });

    // Já atrasada: o prazo corre desde a primeira recusa.
    if (subscription.status === 'PAST_DUE') return;
    // Cancelada ou encerrada: não há o que salvar.
    if (!['TRIAL', 'ACTIVE'].includes(subscription.status)) return;

    const now = new Date();
    const graceEndsAt = new Date(now.getTime() + PAYMENT_GRACE_DAYS * DAY_MS);
    const afterTrial = subscription.status === 'TRIAL';

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'PAST_DUE',
        endDate: graceEndsAt,
        metadata: {
          ...metadataOf(subscription),
          paymentFailedAt: now.toISOString(),
        },
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        action: 'PAYMENT_FAILED',
        fromPlan: subscription.planType,
        toPlan: subscription.planType,
        reason: `${afterTrial ? 'Cobrança do fim do teste' : 'Renovação'} recusada; encerra em ${graceEndsAt.toISOString().slice(0, 10)} sem pagamento`,
      },
    });

    await this.updateUserPlanCache(subscription.userId);

    if (subscription.user.email) {
      await this.mailService.sendPaymentFailedEmail(subscription.user.email, {
        firstName: subscription.user.firstName ?? 'Usuário',
        planType: subscription.planType,
        amount: invoice.amountDue,
        graceEndsAt,
        afterTrial,
      });
    }
  }

  /**
   * Registra a **renovação** paga de uma assinatura — a fatura do segundo mês
   * em diante, que não passa por checkout nenhum.
   *
   * **Sem isto, quem paga em dia perde o acesso.** O `endDate` era gravado uma
   * única vez, no checkout (hoje + 30 ou + 365 dias), e nada o atualizava
   * depois. O Stripe cobrava o mês seguinte, o dinheiro entrava, e o cron
   * `check-subscriptions` — que varre `endDate < agora` — marcava a assinatura
   * como `EXPIRED` e rebaixava o plano no 31º dia. O caminho oposto existia
   * desde sempre (`invoice.payment_failed` → `PAST_DUE`); o de sucesso, não.
   * Não aparece em teste manual: só um mês depois da primeira assinatura.
   *
   * **A data vem do Stripe, não de `+30 dias`.** Quem decide o fim do ciclo é
   * quem cobra; somar dias aqui faria as duas datas divergirem um pouco a cada
   * mês, até o acesso cair antes da cobrança (ou sobrar depois dela).
   *
   * Idempotente pela fatura: a mesma pode chegar por mais de um evento
   * (`invoice.paid` e `invoice.payment_succeeded` descrevem a mesma cobrança),
   * e a trava por `event.id` não cobre isso — ela só impede reprocessar o
   * **mesmo** evento.
   */
  async registerRenewal(invoice: {
    id: string;
    stripeSubscriptionId: string;
    amountPaid: number;
    currency: string;
    periodEnd: Date | null;
  }): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: invoice.stripeSubscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      this.logger.warn(
        `Renovação sem assinatura conhecida (stripeSubscriptionId=${invoice.stripeSubscriptionId})`,
      );
      return;
    }

    const jaRegistrado = await this.prisma.payment.findFirst({
      where: { stripeInvoiceId: invoice.id, status: 'APPROVED' },
    });

    if (jaRegistrado) {
      this.logger.debug(`Fatura ${invoice.id} já registrada, ignorando`);
      return;
    }

    const now = new Date();

    // Sem data do Stripe, o ciclo declarado na assinatura é o melhor palpite —
    // melhor do que deixar o acesso vencer por falta de informação.
    const endDate =
      invoice.periodEnd ??
      new Date(
        now.getTime() +
          (subscription.billingPeriod === 'YEARLY' ? 365 : 30) *
            24 *
            60 *
            60 *
            1000,
      );

    // A descida agendada vale a partir desta fatura: o Stripe já cobrou o
    // preço novo (`changePriceAtRenewal`), e o plano daqui acompanha.
    const { pendingDowngrade } = metadataOf(subscription);
    const metadata = { ...metadataOf(subscription) };
    delete metadata.pendingDowngrade;
    delete metadata.paymentFailedAt;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        // `PAST_DUE` volta a valer: uma cobrança que falhou e foi recuperada
        // na tentativa seguinte não pode deixar a assinatura marcada como
        // atrasada. O teste que acabou com a cobrança aceita vira ativa.
        status: 'ACTIVE',
        endDate,
        metadata,
        ...(pendingDowngrade
          ? { planType: pendingDowngrade, price: invoice.amountPaid }
          : {}),
      },
    });

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        stripeInvoiceId: invoice.id,
        amount: invoice.amountPaid,
        finalAmount: invoice.amountPaid,
        currency: invoice.currency.toUpperCase(),
        status: 'APPROVED',
        paymentMethod: 'CREDIT_CARD',
        payerEmail: subscription.user.email,
        paidAt: now,
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        action: 'RENEWED',
        fromPlan: subscription.planType,
        toPlan: pendingDowngrade ?? subscription.planType,
        toPrice: invoice.amountPaid,
        reason:
          subscription.status === 'TRIAL'
            ? 'Fim do teste: primeira cobrança aceita pelo Stripe'
            : pendingDowngrade
              ? `Renovação no plano ${pendingDowngrade} (descida agendada)`
              : 'Renovação cobrada pelo Stripe',
      },
    });

    await this.invoicesService.createFromPayment(subscription.id, payment.id);
    await this.updateUserPlanCache(subscription.userId);

    this.logger.log(
      `Assinatura ${subscription.id} renovada até ${endDate.toISOString()}`,
    );
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
    const pastDue = subscription.status === 'PAST_DUE';

    // No Stripe primeiro: se ele recusar, nada muda aqui — dizer "cancelada"
    // enquanto o Stripe segue cobrando é o pior desfecho. Em dia (ou no
    // teste), cancela no fim do período e nada mais é cobrado; atrasada,
    // encerra agora, porque não há período pago a honrar.
    if (subscription.stripeSubscriptionId) {
      if (pastDue) {
        await this.stripeService.cancelSubscriptionNow(
          subscription.stripeSubscriptionId,
        );
      } else {
        await this.stripeService.setCancelAtPeriodEnd(
          subscription.stripeSubscriptionId,
          true,
        );
      }
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        autoRenew: false,
        ...(pastDue ? { endDate: now } : {}),
        metadata: {
          ...metadataOf(subscription),
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
        ? `Assinatura cancelada. Você terá acesso até ${subscription.endDate.toISOString().slice(0, 10)}`
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

    if (subscription.stripeSubscriptionId) {
      await this.stripeService.setCancelAtPeriodEnd(
        subscription.stripeSubscriptionId,
        false,
      );
    }

    const stillInTrial =
      subscription.trialEndDate !== null &&
      subscription.trialEndDate > new Date();

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: stillInTrial ? 'TRIAL' : 'ACTIVE',
        cancelledAt: null,
        autoRenew: true,
        metadata: {
          ...metadataOf(subscription),
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
      // Com Stripe, a próxima cobrança já sai no preço do plano novo, e o
      // plano daqui muda quando ela for paga. Antes a descida ficava só
      // anotada: o Stripe renovava no plano caro e nada mais acontecia.
      // Plano concedido pela equipe (sem Stripe) não renova: só anota.
      if (current.stripeSubscriptionId) {
        await this.stripeService.changePriceAtRenewal(
          current.stripeSubscriptionId,
          await this.stripeCatalog.priceIdFor(
            dto.newPlanType,
            dto.billingPeriod ?? current.billingPeriod ?? 'MONTHLY',
          ),
        );
      }

      await this.prisma.subscription.update({
        where: { id: current.id },
        data: {
          autoRenew: Boolean(current.stripeSubscriptionId),
          metadata: {
            ...metadataOf(current),
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
      priceId: await this.stripeCatalog.priceIdFor(
        dto.newPlanType,
        dto.billingPeriod ?? 'MONTHLY',
      ),
      customerId: current.stripeCustomerId,
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

  /**
   * Assinar um plano para professores (Mentor ou Maestro) faz da conta um
   * professor, **sem verificação nem convite**: o portal de ensino fica
   * liberado assim que o plano dá acesso — no início do teste ou na
   * confirmação do pagamento. O perfil nasce (ou volta) ativo; o selo de
   * verificado continua sendo decisão da equipe.
   *
   * Idempotente: roda de novo a cada confirmação e só mexe no que falta.
   */
  async activateTeacherForPlan(userId: string, planType: PlanType) {
    if (!TEACHER_PLANS.includes(planType)) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isTeacher: true,
        teacherProfile: { select: { id: true, status: true } },
      },
    });
    if (!user) return;

    const profile = user.teacherProfile;
    if (user.isTeacher && profile?.status === TeacherStatus.ACTIVE) return;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.user.update({
        where: { id: userId },
        data: { isTeacher: true },
      });
      if (!profile) {
        await tx.teacher.create({
          data: { userId, status: TeacherStatus.ACTIVE, isVerified: false },
        });
      } else if (profile.status !== TeacherStatus.ACTIVE) {
        await tx.teacher.update({
          where: { id: profile.id },
          data: { status: TeacherStatus.ACTIVE },
        });
      }
    });

    // Um professor novo muda o diretório público.
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);
    this.logger.log(`Conta ${userId} virou professor pelo plano ${planType}`);
  }

  /**
   * Plano concedido pela equipe, sem cobrança — o que acompanha um convite
   * para ser professor. Assinatura ativa, sem Stripe e sem renovação;
   * `expiresAt` nulo é sem vencimento. Quando vence, o cron
   * `check-subscriptions` a expira como qualquer outra e a conta volta ao
   * plano gratuito.
   */
  async grantPlan(
    userId: string,
    planType: PlanType,
    expiresAt: Date | null,
    grantedBy?: string,
  ): Promise<Subscription> {
    if (planType === 'FREE') {
      throw new BadRequestException('Conceda um plano pago');
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        planType,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: expiresAt,
        price: 0,
        autoRenew: false,
        metadata: { origin: 'GRANTED_BY_TEAM', grantedBy: grantedBy ?? null },
      },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        userId,
        action: 'CREATED',
        toPlan: planType,
        toPrice: 0,
        reason: expiresAt
          ? `Concedido pela equipe até ${expiresAt.toISOString().slice(0, 10)}`
          : 'Concedido pela equipe, sem vencimento',
      },
    });

    await this.updateUserPlanCache(userId);
    return subscription;
  }

  /**
   * A equipe muda o plano que concedeu — Mentor ↔ Maestro e o vencimento
   * (nulo: sem vencimento). Sem plano concedido em vigor, concede um novo.
   *
   * **Só plano concedido.** Uma assinatura paga pelo Stripe não se mexe por
   * aqui: o preço e o ciclo dela são do Stripe, e mudar o plano sem mudar a
   * cobrança faria os dois lados divergirem.
   */
  async updateGrantedPlan(
    userId: string,
    changes: { planType?: PlanType; expiresAt?: Date | null },
    actingUserId: string,
  ): Promise<Subscription> {
    if (changes.expiresAt && changes.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('O vencimento do plano precisa ser futuro');
    }

    const current = await this.getCurrentSubscription(userId);
    if (current?.stripeSubscriptionId) {
      throw new BadRequestException(
        'Esta conta paga pelo Stripe: o plano muda pela própria assinatura',
      );
    }

    const granted =
      current && metadataOf(current).origin === 'GRANTED_BY_TEAM'
        ? current
        : null;

    if (!granted) {
      if (!changes.planType || changes.planType === 'FREE') {
        throw new BadRequestException('Escolha o plano a conceder');
      }
      const created = await this.grantPlan(
        userId,
        changes.planType,
        changes.expiresAt ?? null,
        actingUserId,
      );
      await this.activateTeacherForPlan(userId, changes.planType);
      return created;
    }

    const planType = changes.planType ?? granted.planType;
    if (planType === 'FREE') {
      throw new BadRequestException('Conceda um plano pago');
    }
    const endDate =
      changes.expiresAt !== undefined ? changes.expiresAt : granted.endDate;

    const updated = await this.prisma.subscription.update({
      where: { id: granted.id },
      data: { planType, endDate },
    });

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: granted.id,
        userId,
        action: 'GRANT_UPDATED',
        fromPlan: granted.planType,
        toPlan: planType,
        toPrice: 0,
        reason: endDate
          ? `Plano concedido alterado pela equipe: ${planType} até ${endDate.toISOString().slice(0, 10)}`
          : `Plano concedido alterado pela equipe: ${planType}, sem vencimento`,
      },
    });

    await this.updateUserPlanCache(userId);
    await this.activateTeacherForPlan(userId, planType);
    return updated;
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
      throw new BadRequestException(COUPON_INVALID);
    }

    const usage = await this.prisma.couponUsage.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (usage) {
      throw new BadRequestException(COUPON_INVALID);
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException(COUPON_INVALID);
    }

    if (
      coupon.applicablePlans.length > 0 &&
      !coupon.applicablePlans.includes(planType)
    ) {
      throw new BadRequestException(COUPON_INVALID);
    }

    return coupon;
  }

  /** O cliente do Stripe da pessoa, se ela já teve um: o checkout o reaproveita. */
  private async stripeCustomerIdOf(userId: string): Promise<string | null> {
    const previous = await this.prisma.subscription.findFirst({
      where: { userId, stripeCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { stripeCustomerId: true },
    });
    return previous?.stripeCustomerId ?? null;
  }

  private getFrontendBaseUrl(): string {
    return this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }
}
