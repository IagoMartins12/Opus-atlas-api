import { AppCacheService } from '../../common/cache/cache.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { PlanPricingService } from './plan-pricing.service';
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeService } from './stripe.service';
import { SubscriptionsService } from './subscriptions.service';

const USER = '64b000000000000000000001';
const SUB = '64b0000000000000000000a1';
const DAY = 24 * 60 * 60 * 1000;

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: SUB,
  userId: USER,
  planType: 'PLUS',
  billingPeriod: 'MONTHLY',
  status: 'ACTIVE',
  price: 29.9,
  endDate: new Date(Date.now() + 10 * DAY),
  trialEndDate: null,
  metadata: null,
  couponId: null,
  ...overrides,
});

describe('SubscriptionsService', () => {
  let prisma: {
    subscription: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    subscriptionHistory: { create: jest.Mock; findMany: jest.Mock };
    payment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: {
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    teacher: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
    teacherStudent: { findMany: jest.Mock };
    $transaction: jest.Mock;
    coupon: { findFirst: jest.Mock; update: jest.Mock };
    couponUsage: { findUnique: jest.Mock; create: jest.Mock };
  };
  let pricing: { calculateFinalPrice: jest.Mock };
  let stripe: {
    createCheckoutSession: jest.Mock;
    retrieveCheckoutSession: jest.Mock;
    setCancelAtPeriodEnd: jest.Mock;
    cancelSubscriptionNow: jest.Mock;
    changePriceAtRenewal: jest.Mock;
    changePriceNow: jest.Mock;
    feeForInvoice: jest.Mock;
    feeForSession: jest.Mock;
  };
  let catalog: { priceIdFor: jest.Mock; checkoutCouponId: jest.Mock };
  let invoices: { createFromPayment: jest.Mock };
  let mail: {
    sendPaymentApprovedEmail: jest.Mock;
    sendSubscriptionCancelledEmail: jest.Mock;
    sendTrialStartedEmail: jest.Mock;
    sendPaymentFailedEmail: jest.Mock;
  };
  let service: SubscriptionsService;
  let cache: { invalidateMany: jest.Mock };

  beforeEach(() => {
    prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'nova', ...data })),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...subscription(), ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      subscriptionHistory: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'pay-1', ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: USER,
          email: 'ana@x.com',
          firstName: 'Ana',
        }),
        findUnique: jest.fn().mockResolvedValue({
          isTeacher: false,
          teacherProfile: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      teacher: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // Sem vínculo de aluno: o plano efetivo é o da assinatura.
      student: { findUnique: jest.fn().mockResolvedValue(null) },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
      coupon: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      couponUsage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    pricing = {
      calculateFinalPrice: jest.fn().mockResolvedValue({
        originalPrice: 29.9,
        discount: 0,
        finalPrice: 29.9,
      }),
    };
    stripe = {
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ id: 'cs_1', url: 'https://checkout/cs_1' }),
      retrieveCheckoutSession: jest.fn(),
      setCancelAtPeriodEnd: jest.fn().mockResolvedValue(undefined),
      cancelSubscriptionNow: jest.fn().mockResolvedValue(undefined),
      changePriceAtRenewal: jest.fn().mockResolvedValue(undefined),
      // A taxa que o Stripe cobrou: 3,99% + R$ 0,39 sobre R$ 39,90 = R$ 1,98.
      feeForInvoice: jest.fn().mockResolvedValue({
        feeCents: 198,
        currency: 'BRL',
        paymentIntentId: 'pi_1',
      }),
      feeForSession: jest.fn().mockResolvedValue({
        feeCents: 198,
        currency: 'BRL',
        paymentIntentId: 'pi_1',
      }),
      changePriceNow: jest.fn().mockResolvedValue({
        invoiceId: 'in_up',
        amountPaid: 21.5,
        currency: 'brl',
        periodEnd: new Date('2026-11-20T00:00:00Z'),
      }),
    };
    catalog = {
      priceIdFor: jest.fn().mockResolvedValue('price_vigente'),
      checkoutCouponId: jest.fn().mockResolvedValue('stripe_cupom'),
    };
    invoices = { createFromPayment: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    mail = {
      sendPaymentApprovedEmail: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue(undefined),
      sendTrialStartedEmail: jest.fn().mockResolvedValue(undefined),
      sendPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      pricing as unknown as PlanPricingService,
      stripe as unknown as StripeService,
      catalog as unknown as StripeCatalogService,
      invoices as unknown as InvoicesService,
      mail as unknown as MailService,
      {
        get: jest.fn((_key: string, fallback: string) => fallback),
      } as unknown as ConfigService,
      cache as unknown as AppCacheService,
    );
    // A transação roda o callback com o próprio mock como cliente.
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
  });

  describe('plano atual', () => {
    // A mensagem de cancelamento promete acesso até o fim do período pago.
    it('cancelada e atrasada dão acesso até endDate; checkout aberto não dá', async () => {
      await service.getCurrentSubscription(USER);

      const [{ where }] = prisma.subscription.findFirst.mock.calls[0];
      expect(where.userId).toBe(USER);
      expect(where.OR).toEqual([
        {
          status: { in: ['TRIAL', 'ACTIVE'] },
          OR: [{ endDate: null }, { endDate: { gte: expect.any(Date) } }],
        },
        {
          status: { in: ['CANCELLED', 'PAST_DUE'] },
          endDate: { gte: expect.any(Date) },
        },
      ]);
    });

    it('sem assinatura é o gratuito, com as features dele', async () => {
      const current = await service.getCurrent(USER);

      expect(current.plan).toMatchObject({
        type: 'FREE',
        isTrialActive: false,
        trialDaysRemaining: 0,
        expiresAt: null,
      });
      expect(current.subscription).toBeNull();
    });

    it('teste em andamento conta os dias que faltam', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({
          status: 'TRIAL',
          trialEndDate: new Date(Date.now() + 3 * DAY - 1000),
        }),
      );

      const current = await service.getCurrent(USER);

      expect(current.plan).toMatchObject({
        type: 'PLUS',
        isTrialActive: true,
        trialDaysRemaining: 3,
      });
    });

    // O 0 é "o plano não oferece", não "sem limite".
    it('checkFeatureAccess devolve o 0 como 0', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ planType: 'PLUS' }),
      );

      const access = await service.checkFeatureAccess(USER, 'maxStudents');

      expect(access.limit).toBe(0);
    });

    it('checkFeatureAccess lê o limite do plano', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ planType: 'MAESTRO' }),
      );

      const access = await service.checkFeatureAccess(USER, 'maxStudents');

      expect(access.plan).toBe('MAESTRO');
      expect(typeof access.hasAccess).toBe('boolean');
    });
  });

  describe('criar', () => {
    it('recusa quem já tem assinatura com acesso', async () => {
      prisma.subscription.findFirst.mockResolvedValue(subscription());

      await expect(
        service.create(USER, 'a@x.com', 'Ana', {
          planType: 'PLUS',
          billingPeriod: 'MONTHLY',
        }),
      ).rejects.toThrow('Para mudar de plano');
    });

    // B2: cancelada ou atrasada tem o seu caminho, e a mensagem diz qual.
    it('cancelada manda reativar; atrasada manda atualizar o cartão', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'CANCELLED' }),
      );
      await expect(
        service.create(USER, 'a@x.com', 'Ana', {
          planType: 'MENTOR',
          billingPeriod: 'MONTHLY',
        }),
      ).rejects.toThrow('reative-a');

      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'PAST_DUE' }),
      );
      await expect(
        service.create(USER, 'a@x.com', 'Ana', {
          planType: 'MENTOR',
          billingPeriod: 'MONTHLY',
        }),
      ).rejects.toThrow('Atualize o cartão');
    });

    it('plano pago exige período', async () => {
      await expect(
        service.create(USER, 'a@x.com', 'Ana', { planType: 'PLUS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('gratuito: cria ativa, sem Stripe, e atualiza o plano do usuário', async () => {
      const result = await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'FREE',
      });

      expect(result.subscription).toMatchObject({
        planType: 'FREE',
        status: 'ACTIVE',
        price: 0,
      });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentPlan: 'FREE' }),
        }),
      );
    });

    // Antes o teste começava ao abrir o checkout: quem desistia ficava com o
    // plano, e o Stripe cobrava na hora quem seguia.
    it('primeira assinatura paga: o teste é do Stripe e nada vale antes do checkout', async () => {
      const result = await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'PLUS',
        billingPeriod: 'MONTHLY',
      });

      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 7, customerId: null }),
      );
      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({
        status: 'PENDING',
        stripeSessionId: 'cs_1',
        price: 29.9,
        metadata: { trialDays: 7 },
      });
      expect(data.trialEndDate).toBeUndefined();
      expect(prisma.teacher.create).not.toHaveBeenCalled();
      expect(result.payment).toEqual({
        sessionId: 'cs_1',
        checkoutUrl: 'https://checkout/cs_1',
      });
    });

    it('quem já foi cliente no Stripe volta como o mesmo cliente', async () => {
      prisma.subscription.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          where.stripeCustomerId ? { stripeCustomerId: 'cus_9' } : null,
        ),
      );

      await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'PLUS',
        billingPeriod: 'MONTHLY',
      });

      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_9' }),
      );
    });

    // Sem isto, deixar o teste expirar e assinar de novo dava outro teste.
    it('quem já teve plano pago não ganha outro teste: espera o pagamento', async () => {
      prisma.subscription.count.mockResolvedValue(1);

      const result = await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'MENTOR',
        billingPeriod: 'YEARLY',
      });

      const [{ where }] = prisma.subscription.count.mock.calls[0];
      expect(where.stripeSubscriptionId).toEqual({ not: null });
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 0 }),
      );
      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({ status: 'PENDING' });
      expect(result.message).toBe('Redirecionando para o checkout seguro...');
    });

    it('cupom entra no preço, mas só é consumido quando o pagamento confirma', async () => {
      prisma.coupon.findFirst.mockResolvedValue({
        id: 'cup-1',
        type: 'PERCENTAGE',
        discountValue: 20,
        maxDiscount: null,
        maxUses: 10,
        usedCount: 1,
        applicablePlans: [],
      });
      pricing.calculateFinalPrice.mockResolvedValue({
        originalPrice: 29.9,
        discount: 5.98,
        finalPrice: 23.92,
      });

      await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'PLUS',
        billingPeriod: 'MONTHLY',
        couponCode: 'promo20',
      });

      expect(prisma.coupon.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ code: 'PROMO20' }),
        }),
      );
      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({
        couponId: 'cup-1',
        price: 23.92,
        metadata: { couponDiscount: 5.98 },
      });
      expect(prisma.couponUsage.create).not.toHaveBeenCalled();
      expect(prisma.coupon.update).not.toHaveBeenCalled();
      // O cupom vai na sessão do Stripe: sem isso a pessoa via "cupom
      // aplicado" e pagava o preço cheio.
      expect(catalog.checkoutCouponId).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cup-1' }),
        29.9,
        5.98,
      );
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_vigente',
          stripeCouponId: 'stripe_cupom',
        }),
      );
    });

    it('sem cupom, a sessão usa o preço vigente e nenhum desconto', async () => {
      await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'PLUS',
        billingPeriod: 'YEARLY',
      });

      expect(catalog.priceIdFor).toHaveBeenCalledWith('PLUS', 'YEARLY');
      expect(catalog.checkoutCouponId).not.toHaveBeenCalled();
      expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          priceId: 'price_vigente',
          stripeCouponId: null,
        }),
      );
    });

    describe('cupom recusado', () => {
      const base = {
        id: 'cup-1',
        maxUses: null,
        usedCount: 0,
        applicablePlans: [] as string[],
      };
      const tryCoupon = () =>
        service.create(USER, 'a@x.com', 'Ana', {
          planType: 'PLUS',
          billingPeriod: 'MONTHLY',
          couponCode: 'X',
        });

      it('inexistente ou vencido', async () => {
        await expect(tryCoupon()).rejects.toThrow('Cupom inválido ou expirado');
      });

      it('já usado pela pessoa', async () => {
        prisma.coupon.findFirst.mockResolvedValue(base);
        prisma.couponUsage.findUnique.mockResolvedValue({ id: 'u' });
        await expect(tryCoupon()).rejects.toThrow('Cupom inválido ou expirado');
      });

      it('esgotado', async () => {
        prisma.coupon.findFirst.mockResolvedValue({
          ...base,
          maxUses: 5,
          usedCount: 5,
        });
        await expect(tryCoupon()).rejects.toThrow('Cupom inválido ou expirado');
      });

      it('de outro plano', async () => {
        prisma.coupon.findFirst.mockResolvedValue({
          ...base,
          applicablePlans: ['MAESTRO'],
        });
        await expect(tryCoupon()).rejects.toThrow('Cupom inválido ou expirado');
      });
    });
  });

  describe('confirmar o checkout', () => {
    const paidSession = {
      id: 'cs_1',
      payment_status: 'paid',
      subscription: 'sub_stripe',
      customer: { id: 'cus_1' },
      amount_total: 2990,
      currency: 'brl',
      customer_email: null,
    };

    beforeEach(() => {
      prisma.subscription.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          where.stripeSessionId
            ? {
                ...subscription({ status: 'PENDING', endDate: null }),
                user: { email: 'ana@x.com', firstName: null },
              }
            : where.id === 'antiga'
              ? subscription({
                  id: 'antiga',
                  stripeSubscriptionId: 'sub_velha',
                })
              : null,
        ),
      );
      stripe.retrieveCheckoutSession.mockResolvedValue(paidSession);
    });

    it('ativa, registra pagamento, nota e avisa por e-mail', async () => {
      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          trialEndDate: null,
          stripeSubscriptionId: 'sub_stripe',
          stripeCustomerId: 'cus_1',
        }),
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 29.9,
          currency: 'BRL',
          status: 'APPROVED',
          payerEmail: 'ana@x.com',
        }),
      });
      expect(invoices.createFromPayment).toHaveBeenCalledWith(SUB, 'pay-1');
      expect(mail.sendPaymentApprovedEmail).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({ firstName: 'Usuário', amount: 29.9 }),
      );
    });

    it('anual vale um ano', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ billingPeriod: 'YEARLY', status: 'PENDING' }),
        user: { email: null },
      });

      await service.confirmCheckoutSession('cs_1');

      const [{ data }] = prisma.subscription.updateMany.mock.calls[0];
      expect(data.endDate.getTime()).toBeGreaterThan(Date.now() + 364 * DAY);
      expect(mail.sendPaymentApprovedEmail).not.toHaveBeenCalled();
    });

    // Retorno e webhook confirmam o mesmo checkout.
    it('confirmação repetida não duplica nada', async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });

      await service.confirmCheckoutSession('cs_1');

      expect(stripe.retrieveCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('retorno e webhook ao mesmo tempo: só quem tira de PENDING segue', async () => {
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(mail.sendPaymentApprovedEmail).not.toHaveBeenCalled();
    });

    it('com teste: começa o teste com o cartão aceito, sem pagamento nem nota', async () => {
      const trialEnd = Math.floor((Date.now() + 7 * DAY) / 1000);
      stripe.retrieveCheckoutSession.mockResolvedValue({
        ...paidSession,
        payment_status: 'no_payment_required',
        amount_total: 0,
        subscription: {
          id: 'sub_stripe',
          status: 'trialing',
          trial_end: trialEnd,
        },
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'TRIAL',
          trialEndDate: new Date(trialEnd * 1000),
          endDate: new Date(trialEnd * 1000),
          stripeSubscriptionId: 'sub_stripe',
        }),
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(invoices.createFromPayment).not.toHaveBeenCalled();
      expect(mail.sendTrialStartedEmail).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({
          chargeDate: new Date(trialEnd * 1000),
          amount: 29.9,
        }),
      );
      expect(mail.sendPaymentApprovedEmail).not.toHaveBeenCalled();
    });

    // A versão atual da API do Stripe devolve "paid" (total 0) no checkout com
    // teste: antes isso virava ativa, com pagamento de R$ 0 (achado da bateria).
    it('teste que o Stripe devolve como "paid" com total 0 ainda é teste', async () => {
      const trialEnd = Math.floor((Date.now() + 7 * DAY) / 1000);
      stripe.retrieveCheckoutSession.mockResolvedValue({
        ...paidSession,
        payment_status: 'paid',
        amount_total: 0,
        subscription: {
          id: 'sub_stripe',
          status: 'trialing',
          trial_end: trialEnd,
        },
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB, status: 'PENDING' },
        data: expect.objectContaining({ status: 'TRIAL' }),
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(mail.sendPaymentApprovedEmail).not.toHaveBeenCalled();
    });

    it('sem pagamento e sem teste no Stripe, não ativa', async () => {
      stripe.retrieveCheckoutSession.mockResolvedValue({
        ...paidSession,
        payment_status: 'no_payment_required',
        subscription: { id: 'sub_stripe', status: 'active', trial_end: null },
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('sessão desconhecida ou não paga não ativa', async () => {
      stripe.retrieveCheckoutSession.mockResolvedValue({
        ...paidSession,
        payment_status: 'unpaid',
      });
      await service.confirmCheckoutSession('cs_1');
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();

      prisma.subscription.findFirst.mockResolvedValue(null);
      await service.confirmCheckoutSession('cs_x');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    // Antes a antiga só mudava aqui e seguia cobrando no Stripe.
    it('upgrade pago: só agora encerra a anterior, aqui e no Stripe', async () => {
      prisma.subscription.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          where.stripeSessionId
            ? {
                ...subscription({
                  status: 'PENDING',
                  metadata: { replacesSubscriptionId: 'antiga' },
                }),
                user: { email: null },
              }
            : where.id === 'antiga'
              ? subscription({
                  id: 'antiga',
                  stripeSubscriptionId: 'sub_velha',
                })
              : null,
        ),
      );

      await service.confirmCheckoutSession('cs_1');

      expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_velha');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'antiga' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });

    it('consome o cupom no pagamento, uma vez só', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({
          status: 'PENDING',
          couponId: 'cup-1',
          metadata: { couponDiscount: 5 },
        }),
        user: { email: null },
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.couponUsage.create).toHaveBeenCalledWith({
        data: { couponId: 'cup-1', userId: USER, discountApplied: 5 },
      });
      expect(prisma.coupon.update).toHaveBeenCalledWith({
        where: { id: 'cup-1' },
        data: { usedCount: { increment: 1 } },
      });
    });

    it('uso de cupom já registrado não conta de novo', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ status: 'PENDING', couponId: 'cup-1' }),
        user: { email: null },
      });
      prisma.couponUsage.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.coupon.update).not.toHaveBeenCalled();
    });

    it('outro erro ao registrar o cupom sobe', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ status: 'PENDING', couponId: 'cup-1' }),
        user: { email: null },
      });
      prisma.couponUsage.create.mockRejectedValue(new Error('mongo'));

      await expect(service.confirmCheckoutSession('cs_1')).rejects.toThrow(
        'mongo',
      );
    });
  });

  describe('cancelar', () => {
    it('sem assinatura é 404; gratuito não cancela', async () => {
      await expect(service.cancel(USER, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ planType: 'FREE' }),
      );
      await expect(service.cancel(USER, {})).rejects.toThrow(
        'Plano gratuito não pode ser cancelado',
      );
    });

    it('cancela, guarda o motivo, avisa e promete acesso até o fim', async () => {
      const endDate = new Date(Date.now() + 10 * DAY);
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ endDate }),
      );

      const result = await service.cancel(USER, {
        reason: 'caro',
        feedback: 'x',
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: expect.objectContaining({
          status: 'CANCELLED',
          autoRenew: false,
          metadata: expect.objectContaining({
            cancelReason: 'caro',
            cancelledBy: 'user',
          }),
        }),
      });
      expect(result.accessUntil).toBe(endDate);
      expect(mail.sendSubscriptionCancelledEmail).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('teste sem data de fim: acesso termina agora', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'TRIAL', endDate: null }),
      );
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: USER,
        email: null,
      });

      const result = await service.cancel(USER, {});

      expect(result.message).toBe('Assinatura cancelada com sucesso');
      expect(mail.sendSubscriptionCancelledEmail).not.toHaveBeenCalled();
    });

    it('com Stripe: cancela lá no fim do período, antes de mudar aqui', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ stripeSubscriptionId: 'sub_1' }),
      );

      await service.cancel(USER, {});

      expect(stripe.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_1', true);
      expect(
        stripe.setCancelAtPeriodEnd.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.subscription.update.mock.invocationCallOrder[0]);
    });

    it('se o Stripe recusar, não se diz "cancelada" aqui', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ stripeSubscriptionId: 'sub_1' }),
      );
      stripe.setCancelAtPeriodEnd.mockRejectedValue(new Error('stripe fora'));

      await expect(service.cancel(USER, {})).rejects.toThrow('stripe fora');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('atrasada: encerra agora, sem período pago a honrar', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'PAST_DUE', stripeSubscriptionId: 'sub_1' }),
      );

      await service.cancel(USER, {});

      expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_1');
      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.endDate).toBeInstanceOf(Date);
    });

    it('não cancela de novo o que já está cancelado', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'CANCELLED' }),
      );

      await expect(service.cancel(USER, {})).rejects.toThrow(
        'Assinatura já cancelada',
      );
    });
  });

  describe('reativar', () => {
    it('reativa a cancelada ainda no período', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ status: 'CANCELLED' }),
      );

      const result = await service.reactivate(USER);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: expect.objectContaining({
          status: 'ACTIVE',
          cancelledAt: null,
          autoRenew: true,
        }),
      });
      expect(result.message).toBe('Assinatura reativada com sucesso!');
    });

    it('com Stripe: desfaz o cancelamento lá; no teste, volta ao teste', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({
          status: 'CANCELLED',
          stripeSubscriptionId: 'sub_1',
          trialEndDate: new Date(Date.now() + 3 * DAY),
        }),
      );

      await service.reactivate(USER);

      expect(stripe.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_1', false);
      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.status).toBe('TRIAL');
    });

    it('sem cancelada no período é 404', async () => {
      await expect(service.reactivate(USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('trocar de plano', () => {
    it('sem assinatura é 404; mesmo plano é 400', async () => {
      await expect(
        service.upgrade(USER, 'a@x.com', { newPlanType: 'MENTOR' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.subscription.findFirst.mockResolvedValue(subscription());
      await expect(
        service.upgrade(USER, 'a@x.com', { newPlanType: 'PLUS' }),
      ).rejects.toThrow('Você já está neste plano');
    });

    it('downgrade fica agendado para o fim do ciclo', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ planType: 'MAESTRO' }),
      );

      const result = await service.upgrade(USER, 'a@x.com', {
        newPlanType: 'PLUS',
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: expect.objectContaining({
          autoRenew: false,
          metadata: expect.objectContaining({ pendingDowngrade: 'PLUS' }),
        }),
      });
      expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
      expect(result.message).toContain('Mudança agendada');
    });

    // Antes a descida ficava só anotada: o Stripe renovava no plano caro.
    it('com Stripe: a próxima cobrança já sai no preço do plano novo', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ planType: 'MAESTRO', stripeSubscriptionId: 'sub_1' }),
      );

      await service.upgrade(USER, 'a@x.com', { newPlanType: 'PLUS' });

      expect(catalog.priceIdFor).toHaveBeenCalledWith('PLUS', 'MONTHLY');
      expect(stripe.changePriceAtRenewal).toHaveBeenCalledWith(
        'sub_1',
        'price_vigente',
      );
      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.autoRenew).toBe(true);
    });

    // Era TRIAL sem fim: checkout abandonado virava upgrade grátis para sempre.
    it('upgrade abre checkout e a assinatura nova espera o pagamento, sem acesso', async () => {
      prisma.subscription.findFirst.mockResolvedValue(subscription());

      const result = await service.upgrade(USER, 'a@x.com', {
        newPlanType: 'MAESTRO',
        billingPeriod: 'YEARLY',
      });

      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({
        planType: 'MAESTRO',
        billingPeriod: 'YEARLY',
        status: 'PENDING',
        metadata: { replacesSubscriptionId: SUB },
      });
      expect(result.payment?.checkoutUrl).toBe('https://checkout/cs_1');
    });

    // Antes: checkout novo, preço cheio e a antiga cancelada sem crédito.
    describe('upgrade na própria assinatura (com Stripe)', () => {
      beforeEach(() => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({ stripeSubscriptionId: 'sub_1' }),
        );
        prisma.subscription.update.mockResolvedValue(subscription());
      });

      it('troca o preço, cobra só a diferença e não abre checkout', async () => {
        const result = await service.upgrade(USER, 'a@x.com', {
          newPlanType: 'MAESTRO',
        });

        expect(stripe.changePriceNow).toHaveBeenCalledWith(
          'sub_1',
          'price_vigente',
        );
        expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
        expect(prisma.subscription.create).not.toHaveBeenCalled();
        expect(stripe.cancelSubscriptionNow).not.toHaveBeenCalled();
        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data).toMatchObject({
          planType: 'MAESTRO',
          endDate: new Date('2026-11-20T00:00:00Z'),
        });
        expect(prisma.payment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            stripeInvoiceId: 'in_up',
            finalAmount: 21.5,
            status: 'APPROVED',
          }),
        });
        expect(result.message).toContain('diferença');
      });

      it('cartão recusado: mensagem com o caminho, em vez do erro do Stripe', async () => {
        stripe.changePriceNow.mockRejectedValue(
          Object.assign(new Error('Your card was declined.'), {
            type: 'StripeCardError',
          }),
        );

        await expect(
          service.upgrade(USER, 'a@x.com', { newPlanType: 'MAESTRO' }),
        ).rejects.toThrow('você continua no Plus');
        expect(prisma.subscription.update).not.toHaveBeenCalled();
      });

      it('cartão recusado: o Stripe falha e nada muda aqui', async () => {
        stripe.changePriceNow.mockRejectedValue(new Error('card_declined'));

        await expect(
          service.upgrade(USER, 'a@x.com', { newPlanType: 'MAESTRO' }),
        ).rejects.toThrow('card_declined');

        expect(prisma.subscription.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).not.toHaveBeenCalled();
      });

      it('durante o teste não há cobrança nem pagamento', async () => {
        stripe.changePriceNow.mockResolvedValue({
          invoiceId: null,
          amountPaid: 0,
          currency: 'brl',
          periodEnd: null,
        });

        const result = await service.upgrade(USER, 'a@x.com', {
          newPlanType: 'MAESTRO',
        });

        expect(prisma.payment.create).not.toHaveBeenCalled();
        expect(result.message).toContain('primeira cobrança');
      });

      // S-47: quem diz se ainda é teste é o Stripe, não a data gravada.
      it('cancelada que sobe ainda no teste do Stripe volta a teste', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({ stripeSubscriptionId: 'sub_1', status: 'CANCELLED' }),
        );
        stripe.changePriceNow.mockResolvedValue({
          invoiceId: null,
          amountPaid: 0,
          currency: 'brl',
          periodEnd: null,
          status: 'trialing',
        });

        await service.upgrade(USER, 'a@x.com', { newPlanType: 'MAESTRO' });

        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data.status).toBe('TRIAL');
      });

      // B3: subir desfaz o cancelamento no Stripe e o estado volta aqui.
      it('cancelada que sobe volta a ativa', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({ stripeSubscriptionId: 'sub_1', status: 'CANCELLED' }),
        );

        await service.upgrade(USER, 'a@x.com', { newPlanType: 'MAESTRO' });

        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data).toMatchObject({ status: 'ACTIVE', cancelledAt: null });
      });

      it('mensal → anual no mesmo plano sobe agora, no preço anual', async () => {
        await service.upgrade(USER, 'a@x.com', {
          newPlanType: 'PLUS',
          billingPeriod: 'YEARLY',
        });

        expect(catalog.priceIdFor).toHaveBeenCalledWith('PLUS', 'YEARLY');
        expect(stripe.changePriceNow).toHaveBeenCalled();
        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data).toMatchObject({
          planType: 'PLUS',
          billingPeriod: 'YEARLY',
        });
      });

      it('anual → mensal fica para a renovação', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({
            stripeSubscriptionId: 'sub_1',
            billingPeriod: 'YEARLY',
          }),
        );

        await service.upgrade(USER, 'a@x.com', {
          newPlanType: 'PLUS',
          billingPeriod: 'MONTHLY',
        });

        expect(stripe.changePriceAtRenewal).toHaveBeenCalled();
        expect(stripe.changePriceNow).not.toHaveBeenCalled();
        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data.metadata).toMatchObject({
          pendingDowngrade: 'PLUS',
          pendingBillingPeriod: 'MONTHLY',
        });
      });

      // S-34: desistir da descida agendada escolhendo o próprio plano.
      it('escolher o próprio plano com descida agendada desfaz a descida', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({
            stripeSubscriptionId: 'sub_1',
            planType: 'MAESTRO',
            metadata: {
              pendingDowngrade: 'PLUS',
              pendingBillingPeriod: 'MONTHLY',
            },
          }),
        );

        const result = await service.upgrade(USER, 'a@x.com', {
          newPlanType: 'MAESTRO',
        });

        expect(catalog.priceIdFor).toHaveBeenCalledWith('MAESTRO', 'MONTHLY');
        expect(stripe.changePriceAtRenewal).toHaveBeenCalledWith(
          'sub_1',
          'price_vigente',
        );
        const [{ data }] = prisma.subscription.update.mock.calls[0];
        expect(data.metadata).toEqual({});
        expect(result.message).toContain('Maestro');
      });

      it('cancelada não agenda descida; atrasada não desce', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({
            stripeSubscriptionId: 'sub_1',
            planType: 'MAESTRO',
            status: 'CANCELLED',
          }),
        );
        await expect(
          service.upgrade(USER, 'a@x.com', { newPlanType: 'PLUS' }),
        ).rejects.toThrow('Reative-a');

        prisma.subscription.findFirst.mockResolvedValue(
          subscription({
            stripeSubscriptionId: 'sub_1',
            planType: 'MAESTRO',
            status: 'PAST_DUE',
          }),
        );
        await expect(
          service.upgrade(USER, 'a@x.com', { newPlanType: 'PLUS' }),
        ).rejects.toThrow('em atraso');
        expect(stripe.changePriceAtRenewal).not.toHaveBeenCalled();
      });

      it('assinatura atrasada não sobe de plano', async () => {
        prisma.subscription.findFirst.mockResolvedValue(
          subscription({ stripeSubscriptionId: 'sub_1', status: 'PAST_DUE' }),
        );

        await expect(
          service.upgrade(USER, 'a@x.com', { newPlanType: 'MAESTRO' }),
        ).rejects.toThrow('em atraso');
        expect(stripe.changePriceNow).not.toHaveBeenCalled();
      });
    });
  });
  /**
   * A renovação — o buraco que deixava cliente pagante sem acesso no 31º dia.
   * `endDate` era gravado uma vez, no checkout, e nada o atualizava depois.
   */
  describe('renovação', () => {
    const fatura = (extra: Record<string, unknown> = {}) => ({
      id: 'in_1',
      stripeSubscriptionId: 'sub_1',
      amountPaid: 39.9,
      currency: 'brl',
      periodEnd: new Date('2026-11-01T00:00:00Z'),
      ...extra,
    });

    beforeEach(() => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription(),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });
    });

    // A receita líquida do financeiro depende da taxa estar no pagamento.
    it('grava no pagamento a taxa que o Stripe cobrou', async () => {
      await service.registerRenewal(fatura());

      expect(stripe.feeForInvoice).toHaveBeenCalledWith('in_1');
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: {
          stripeFeeCents: 198,
          stripeFeeCurrency: 'BRL',
          stripePaymentIntentId: 'pi_1',
        },
      });
    });

    it('sem a taxa lida (Stripe ainda não registrou), o pagamento vale igual', async () => {
      stripe.feeForInvoice.mockResolvedValue(null);

      await service.registerRenewal(fatura());

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('estende o acesso até a data que o Stripe cobrou', async () => {
      await service.registerRenewal(fatura());

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.endDate).toEqual(new Date('2026-11-01T00:00:00Z'));
    });

    it('tira a assinatura de PAST_DUE quando a cobrança é recuperada', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ status: 'PAST_DUE' }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerRenewal(fatura());

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.status).toBe('ACTIVE');
    });

    it('grava o pagamento aprovado com a fatura que o originou', async () => {
      await service.registerRenewal(fatura());

      const [{ data }] = prisma.payment.create.mock.calls[0];
      expect(data).toMatchObject({
        stripeInvoiceId: 'in_1',
        finalAmount: 39.9,
        currency: 'BRL',
        status: 'APPROVED',
      });
    });

    it('não registra duas vezes a mesma fatura', async () => {
      // `invoice.paid` e `invoice.payment_succeeded` descrevem a mesma
      // cobrança: a trava por id de evento não cobre isso.
      prisma.payment.findFirst.mockResolvedValue({ id: 'pay-ja' });

      await service.registerRenewal(fatura());

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('sem data do Stripe, cai no ciclo declarado na assinatura', async () => {
      const antes = Date.now();

      await service.registerRenewal(fatura({ periodEnd: null }));

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      const dias = (data.endDate.getTime() - antes) / DAY;
      expect(dias).toBeGreaterThan(29.9);
      expect(dias).toBeLessThan(30.1);
    });

    it('assinatura desconhecida não cria pagamento órfão', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.registerRenewal(fatura());

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('a descida agendada vale a partir desta fatura', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({
          planType: 'MAESTRO',
          metadata: { pendingDowngrade: 'PLUS', paymentFailedAt: 'x' },
        }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerRenewal(fatura({ amountPaid: 19.9 }));

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data).toMatchObject({
        planType: 'PLUS',
        price: 19.9,
        metadata: {},
      });
    });

    it('a troca de período agendada também vale, e o preço vira o cobrado', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({
          billingPeriod: 'YEARLY',
          price: 150,
          metadata: {
            pendingDowngrade: 'PLUS',
            pendingBillingPeriod: 'MONTHLY',
          },
        }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerRenewal(fatura({ amountPaid: 19.9 }));

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data).toMatchObject({
        billingPeriod: 'MONTHLY',
        price: 19.9,
        metadata: {},
      });
    });

    // O cupom do checkout vale uma vez: o preço gravado com desconto deixava
    // o MRR abaixo do real para sempre.
    it('renovação comum grava o preço cheio que o Stripe cobrou', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ price: 14.95 }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerRenewal(fatura({ amountPaid: 29.9 }));

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.price).toBe(29.9);
    });

    it('registra a renovação no histórico e emite a nota', async () => {
      await service.registerRenewal(fatura());

      const [{ data }] = prisma.subscriptionHistory.create.mock.calls[0];
      expect(data).toMatchObject({ action: 'RENEWED', subscriptionId: SUB });
      expect(invoices.createFromPayment).toHaveBeenCalledWith(SUB, 'pay-1');
    });
  });

  describe('conta apagada (RN-6)', () => {
    it('encerra no Stripe, anonimiza e solta o vínculo, sem apagar o financeiro', async () => {
      const extra = prisma as unknown as Record<
        string,
        Record<string, jest.Mock>
      >;
      extra.subscription.findMany = jest.fn().mockResolvedValue([
        {
          id: 's1',
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_1',
          stripeCustomerId: 'cus_1',
          metadata: { cancelFeedback: 'caro' },
        },
        {
          id: 's0',
          status: 'EXPIRED',
          stripeSubscriptionId: 'sub_0',
          stripeCustomerId: 'cus_1',
          metadata: null,
        },
      ]);
      extra.payment.updateMany = jest.fn().mockResolvedValue({ count: 2 });
      extra.invoice = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
      extra.subscriptionHistory.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 3 });
      (stripe as Record<string, jest.Mock>).deleteCustomer = jest
        .fn()
        .mockResolvedValue(undefined);

      await service.detachForAccountDeletion(USER);

      // Só a viva é encerrada no Stripe; o cliente sai uma vez.
      expect(stripe.cancelSubscriptionNow).toHaveBeenCalledTimes(1);
      expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_1');
      expect(
        (stripe as Record<string, jest.Mock>).deleteCustomer,
      ).toHaveBeenCalledTimes(1);
      const [{ data: viva }] = prisma.subscription.update.mock.calls[0];
      expect(viva).toMatchObject({ userId: null, status: 'CANCELLED' });
      expect(viva.metadata.cancelFeedback).toBeNull();
      const [{ data: antiga }] = prisma.subscription.update.mock.calls[1];
      expect(antiga.userId).toBeNull();
      expect(antiga.status).toBeUndefined();
      expect(extra.payment.updateMany).toHaveBeenCalledWith({
        where: { subscriptionId: { in: ['s1', 's0'] } },
        data: { payerEmail: null, payerName: null, payerDocument: null },
      });
      expect(extra.invoice.updateMany.mock.calls[0][0].data).toMatchObject({
        customerName: 'Conta excluída',
        customerEmail: '',
      });
      expect(extra.subscriptionHistory.updateMany).toHaveBeenCalledWith({
        where: { userId: USER },
        data: { userId: null },
      });
    });

    it('Stripe falhou: nada é anonimizado aqui', async () => {
      const extra = prisma as unknown as Record<
        string,
        Record<string, jest.Mock>
      >;
      extra.subscription.findMany = jest.fn().mockResolvedValue([
        {
          id: 's1',
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_1',
          stripeCustomerId: null,
          metadata: null,
        },
      ]);
      stripe.cancelSubscriptionNow.mockRejectedValue(new Error('stripe fora'));

      await expect(service.detachForAccountDeletion(USER)).rejects.toThrow(
        'stripe fora',
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('portal do Stripe (customer.subscription.updated)', () => {
    const local = (over: Record<string, unknown> = {}) => ({
      ...subscription({ stripeSubscriptionId: 'sub_1', ...over }),
      user: { email: 'ana@x.com', firstName: 'Ana' },
    });

    it('cancelou lá: fica cancelada aqui, com histórico e e-mail', async () => {
      prisma.subscription.findFirst.mockResolvedValue(local());

      await service.syncCancellationFromStripe({
        id: 'sub_1',
        status: 'active',
        cancelAtPeriodEnd: true,
      });

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data).toMatchObject({ status: 'CANCELLED', autoRenew: false });
      expect(mail.sendSubscriptionCancelledEmail).toHaveBeenCalled();
    });

    it('reativou lá: volta a ativa aqui', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        local({ status: 'CANCELLED' }),
      );

      await service.syncCancellationFromStripe({
        id: 'sub_1',
        status: 'active',
        cancelAtPeriodEnd: false,
      });

      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data).toMatchObject({ status: 'ACTIVE', cancelledAt: null });
    });

    it('eco do que nós mesmos fizemos não muda nada', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        local({ status: 'CANCELLED' }),
      );
      await service.syncCancellationFromStripe({
        id: 'sub_1',
        status: 'active',
        cancelAtPeriodEnd: true,
      });
      prisma.subscription.findFirst.mockResolvedValue(local());
      await service.syncCancellationFromStripe({
        id: 'sub_1',
        status: 'active',
        cancelAtPeriodEnd: false,
      });

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe('3-D Secure (invoice.payment_action_required)', () => {
    it('avisa com o link da fatura, uma vez por fatura', async () => {
      (mail as Record<string, jest.Mock>).sendPaymentActionRequiredEmail = jest
        .fn()
        .mockResolvedValue(undefined);
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ stripeSubscriptionId: 'sub_1', status: 'TRIAL' }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerPaymentActionRequired({
        id: 'in_3ds',
        stripeSubscriptionId: 'sub_1',
        amountDue: 29.9,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/x',
      });

      expect(
        (mail as Record<string, jest.Mock>).sendPaymentActionRequiredEmail,
      ).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({
          url: 'https://invoice.stripe.com/i/x',
          afterTrial: true,
        }),
      );

      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({
          stripeSubscriptionId: 'sub_1',
          metadata: { actionRequiredInvoiceId: 'in_3ds' },
        }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });
      await service.registerPaymentActionRequired({
        id: 'in_3ds',
        stripeSubscriptionId: 'sub_1',
        amountDue: 29.9,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/x',
      });
      expect(
        (mail as Record<string, jest.Mock>).sendPaymentActionRequiredEmail,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('cobrança recusada', () => {
    const recusa = {
      stripeSubscriptionId: 'sub_1',
      amountDue: 39.9,
      currency: 'brl',
    };

    it('no fim do teste: atrasada, com prazo para o cartão, e avisa', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ status: 'TRIAL', planType: 'MENTOR' }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });
      const antes = Date.now();

      await service.registerPaymentFailure(recusa);

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'REJECTED',
          finalAmount: 39.9,
        }),
      });
      const [{ data }] = prisma.subscription.update.mock.calls[0];
      expect(data.status).toBe('PAST_DUE');
      const dias = (data.endDate.getTime() - antes) / DAY;
      expect(dias).toBeGreaterThan(3.99);
      expect(dias).toBeLessThan(4.01);
      expect(data.metadata.paymentFailedAt).toEqual(expect.any(String));
      expect(mail.sendPaymentFailedEmail).toHaveBeenCalledWith(
        'ana@x.com',
        expect.objectContaining({ afterTrial: true, amount: 39.9 }),
      );
    });

    it('as tentativas seguintes do Stripe não esticam o prazo', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ status: 'PAST_DUE' }),
        user: { email: 'ana@x.com', firstName: 'Ana' },
      });

      await service.registerPaymentFailure(recusa);

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(mail.sendPaymentFailedEmail).not.toHaveBeenCalled();
    });

    it('assinatura desconhecida não cria pagamento órfão', async () => {
      await service.registerPaymentFailure(recusa);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('professor pela assinatura', () => {
    it('plano Mentor: vira professor ativo quando o teste começa', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ planType: 'MENTOR', status: 'PENDING' }),
        user: { email: null },
      });
      stripe.retrieveCheckoutSession.mockResolvedValue({
        id: 'cs_1',
        payment_status: 'no_payment_required',
        subscription: {
          id: 'sub_1',
          status: 'trialing',
          trial_end: Math.floor((Date.now() + 14 * DAY) / 1000),
        },
        customer: 'cus_1',
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { isTeacher: true },
      });
      expect(prisma.teacher.create).toHaveBeenCalledWith({
        data: { userId: USER, status: 'ACTIVE', isVerified: false },
      });
      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    it('plano Plus não mexe no papel de professor', async () => {
      await service.activateTeacherForPlan(USER, 'PLUS');
      expect(prisma.teacher.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('ex-professor com perfil inativo volta a ativo, sem perfil novo', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isTeacher: false,
        teacherProfile: { id: 't1', status: 'INACTIVE' },
      });
      await service.activateTeacherForPlan(USER, 'MAESTRO');
      expect(prisma.teacher.create).not.toHaveBeenCalled();
      expect(prisma.teacher.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('professor já ativo: nada muda', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isTeacher: true,
        teacherProfile: { id: 't1', status: 'ACTIVE' },
      });
      await service.activateTeacherForPlan(USER, 'MENTOR');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(cache.invalidateMany).not.toHaveBeenCalled();
    });
  });

  describe('plano concedido pela equipe', () => {
    it('cria assinatura ativa, sem cobrança nem renovação, com vencimento', async () => {
      const ate = new Date(Date.now() + 30 * DAY);
      await service.grantPlan(USER, 'MAESTRO', ate, 'admin-1');
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER,
          planType: 'MAESTRO',
          status: 'ACTIVE',
          endDate: ate,
          price: 0,
          autoRenew: false,
        }),
      });
    });

    it('sem vencimento grava endDate nulo', async () => {
      await service.grantPlan(USER, 'MENTOR', null);
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ endDate: null }),
      });
    });

    it('a equipe troca o plano concedido e o vencimento', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({
          planType: 'MENTOR',
          price: 0,
          metadata: { origin: 'GRANTED_BY_TEAM' },
        }),
      );

      await service.updateGrantedPlan(
        USER,
        { planType: 'MAESTRO', expiresAt: null },
        'admin-1',
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: { planType: 'MAESTRO', endDate: null },
      });
      expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'GRANT_UPDATED',
          fromPlan: 'MENTOR',
          toPlan: 'MAESTRO',
        }),
      });
    });

    it('sem plano concedido em vigor, concede um', async () => {
      await service.updateGrantedPlan(
        USER,
        { planType: 'MENTOR', expiresAt: null },
        'admin-1',
      );

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          planType: 'MENTOR',
          metadata: { origin: 'GRANTED_BY_TEAM', grantedBy: 'admin-1' },
        }),
      });
    });

    // Mudar o plano sem mudar a cobrança faria os dois lados divergirem.
    it('assinatura paga pelo Stripe não se edita por aqui', async () => {
      prisma.subscription.findFirst.mockResolvedValue(
        subscription({ stripeSubscriptionId: 'sub_1' }),
      );

      await expect(
        service.updateGrantedPlan(USER, { planType: 'MAESTRO' }, 'admin-1'),
      ).rejects.toThrow('Esta conta paga pelo Stripe');
    });

    it('vencimento no passado é recusado', async () => {
      await expect(
        service.updateGrantedPlan(
          USER,
          { expiresAt: new Date(Date.now() - DAY) },
          'admin-1',
        ),
      ).rejects.toThrow('O vencimento do plano precisa ser futuro');
    });
  });
});
