import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { PlanPricingService } from './plan-pricing.service';
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
    payment: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    coupon: { findFirst: jest.Mock; update: jest.Mock };
    couponUsage: { findUnique: jest.Mock; create: jest.Mock };
  };
  let pricing: { calculateFinalPrice: jest.Mock };
  let stripe: {
    createCheckoutSession: jest.Mock;
    retrieveCheckoutSession: jest.Mock;
  };
  let invoices: { createFromPayment: jest.Mock };
  let mail: {
    sendPaymentApprovedEmail: jest.Mock;
    sendSubscriptionCancelledEmail: jest.Mock;
  };
  let service: SubscriptionsService;

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
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: USER,
          email: 'ana@x.com',
          firstName: 'Ana',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
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
    };
    invoices = { createFromPayment: jest.fn().mockResolvedValue(undefined) };
    mail = {
      sendPaymentApprovedEmail: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      pricing as unknown as PlanPricingService,
      stripe as unknown as StripeService,
      invoices as unknown as InvoicesService,
      mail as unknown as MailService,
      {
        get: jest.fn((_key: string, fallback: string) => fallback),
      } as unknown as ConfigService,
    );
  });

  describe('plano atual', () => {
    // A mensagem de cancelamento promete acesso até o fim do período pago.
    it('cancelada ainda dá acesso até endDate; checkout aberto não dá', async () => {
      await service.getCurrentSubscription(USER);

      const [{ where }] = prisma.subscription.findFirst.mock.calls[0];
      expect(where.userId).toBe(USER);
      expect(where.OR).toEqual([
        {
          status: { in: ['TRIAL', 'ACTIVE'] },
          OR: [{ endDate: null }, { endDate: { gte: expect.any(Date) } }],
        },
        { status: 'CANCELLED', endDate: { gte: expect.any(Date) } },
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
      ).rejects.toThrow('Você já possui uma assinatura ativa');
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

    it('primeira assinatura paga: teste grátis e checkout', async () => {
      const result = await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'PLUS',
        billingPeriod: 'MONTHLY',
      });

      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({
        status: 'TRIAL',
        stripeSessionId: 'cs_1',
        price: 29.9,
      });
      expect(data.trialEndDate.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
      expect(result.message).toBe('Período de teste de 7 dias iniciado!');
      expect(result.payment).toEqual({
        sessionId: 'cs_1',
        checkoutUrl: 'https://checkout/cs_1',
      });
    });

    // Sem isto, deixar o teste expirar e assinar de novo dava outro teste.
    it('quem já teve plano pago não ganha outro teste: espera o pagamento', async () => {
      prisma.subscription.count.mockResolvedValue(1);

      const result = await service.create(USER, 'a@x.com', 'Ana', {
        planType: 'MENTOR',
        billingPeriod: 'YEARLY',
      });

      const [{ data }] = prisma.subscription.create.mock.calls[0];
      expect(data).toMatchObject({ status: 'PENDING', trialEndDate: null });
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
        await expect(tryCoupon()).rejects.toThrow(
          'Você já utilizou este cupom',
        );
      });

      it('esgotado', async () => {
        prisma.coupon.findFirst.mockResolvedValue({
          ...base,
          maxUses: 5,
          usedCount: 5,
        });
        await expect(tryCoupon()).rejects.toThrow('Cupom esgotado');
      });

      it('de outro plano', async () => {
        prisma.coupon.findFirst.mockResolvedValue({
          ...base,
          applicablePlans: ['MAESTRO'],
        });
        await expect(tryCoupon()).rejects.toThrow(
          'Cupom não aplicável a este plano',
        );
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
            : null,
        ),
      );
      stripe.retrieveCheckoutSession.mockResolvedValue(paidSession);
    });

    it('ativa, registra pagamento, nota e avisa por e-mail', async () => {
      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: expect.objectContaining({
          status: 'ACTIVE',
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
        ...subscription({ billingPeriod: 'YEARLY' }),
        user: { email: null },
      });

      await service.confirmCheckoutSession('cs_1');

      const [{ data }] = prisma.subscription.update.mock.calls[0];
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

    it('sessão desconhecida ou não paga não ativa', async () => {
      stripe.retrieveCheckoutSession.mockResolvedValue({
        ...paidSession,
        payment_status: 'unpaid',
      });
      await service.confirmCheckoutSession('cs_1');
      expect(prisma.subscription.update).not.toHaveBeenCalled();

      prisma.subscription.findFirst.mockResolvedValue(null);
      await service.confirmCheckoutSession('cs_x');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('upgrade pago: só agora cancela a assinatura anterior', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ metadata: { replacesSubscriptionId: 'antiga' } }),
        user: { email: null },
      });

      await service.confirmCheckoutSession('cs_1');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'antiga', status: { in: ['TRIAL', 'ACTIVE'] } },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });

    it('consome o cupom no pagamento, uma vez só', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        ...subscription({ couponId: 'cup-1', metadata: { couponDiscount: 5 } }),
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
        ...subscription({ couponId: 'cup-1' }),
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
        ...subscription({ couponId: 'cup-1' }),
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
      expect(result.message).toContain('Downgrade agendado');
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

    it('registra a renovação no histórico e emite a nota', async () => {
      await service.registerRenewal(fatura());

      const [{ data }] = prisma.subscriptionHistory.create.mock.calls[0];
      expect(data).toMatchObject({ action: 'RENEWED', subscriptionId: SUB });
      expect(invoices.createFromPayment).toHaveBeenCalledWith(SUB, 'pay-1');
    });
  });
});
