import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { BillingController } from './billing.controller';
import { CronController } from './cron.controller';
import { CouponsService } from './services/coupons.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { PlanPricingService } from './services/plan-pricing.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionsCronService } from './services/subscriptions-cron.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { WebhookService } from './services/webhook.service';
import { WebhookController } from './webhook.controller';

const user = (role = 0): AccessTokenPayload => ({
  sub: 'u1',
  email: 'a@x.com',
  role,
  isTeacher: false,
  isStudent: false,
  type: 'access',
});

describe('BillingController', () => {
  let pricing: { getPricing: jest.Mock };
  let coupons: { validate: jest.Mock };
  let subscriptions: {
    create: jest.Mock;
    confirmCheckoutSession: jest.Mock;
    getCurrentSubscription: jest.Mock;
    getCurrent: jest.Mock;
    cancel: jest.Mock;
    reactivate: jest.Mock;
    upgrade: jest.Mock;
  };
  let payments: { getHistory: jest.Mock };
  let invoices: { getDetail: jest.Mock; getHtml: jest.Mock };
  let stripe: { createBillingPortalSession: jest.Mock };
  let prisma: { user: { findUniqueOrThrow: jest.Mock } };
  let controller: BillingController;

  beforeEach(() => {
    pricing = { getPricing: jest.fn().mockResolvedValue({ success: true }) };
    coupons = { validate: jest.fn().mockResolvedValue({ valid: true }) };
    subscriptions = {
      create: jest.fn().mockResolvedValue({ success: true }),
      confirmCheckoutSession: jest.fn().mockResolvedValue(undefined),
      getCurrentSubscription: jest.fn().mockResolvedValue(null),
      getCurrent: jest.fn().mockResolvedValue({ success: true }),
      cancel: jest.fn().mockResolvedValue({ success: true }),
      reactivate: jest.fn().mockResolvedValue({ success: true }),
      upgrade: jest.fn().mockResolvedValue({ success: true }),
    };
    payments = { getHistory: jest.fn().mockResolvedValue({ success: true }) };
    invoices = {
      getDetail: jest.fn().mockResolvedValue({ success: true }),
      getHtml: jest.fn().mockResolvedValue('<html>'),
    };
    stripe = {
      createBillingPortalSession: jest
        .fn()
        .mockResolvedValue({ url: 'https://portal' }),
    };
    prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          email: 'a@x.com',
          firstName: 'Ana',
          lastName: null,
        }),
      },
    };
    controller = new BillingController(
      pricing as unknown as PlanPricingService,
      coupons as unknown as CouponsService,
      subscriptions as unknown as SubscriptionsService,
      payments as unknown as PaymentsService,
      invoices as unknown as InvoicesService,
      stripe as unknown as StripeService,
      prisma as unknown as PrismaService,
      {
        get: jest.fn((_k: string, fallback: string) => fallback),
      } as unknown as ConfigService,
    );
  });

  it('preços, cupom, assinatura atual, histórico, cancelar e reativar repassam ao serviço', async () => {
    await controller.getPricing();
    await controller.validateCoupon(user(), { code: 'X', planType: 'PLUS' });
    await controller.getCurrentSubscription(user());
    await controller.cancelSubscription(user(), { reason: 'caro' });
    await controller.reactivateSubscription(user());
    await controller.getPaymentHistory(user());

    expect(pricing.getPricing).toHaveBeenCalled();
    expect(coupons.validate).toHaveBeenCalledWith('u1', {
      code: 'X',
      planType: 'PLUS',
    });
    expect(subscriptions.getCurrent).toHaveBeenCalledWith('u1');
    expect(subscriptions.cancel).toHaveBeenCalledWith('u1', { reason: 'caro' });
    expect(subscriptions.reactivate).toHaveBeenCalledWith('u1');
    expect(payments.getHistory).toHaveBeenCalledWith('u1');
  });

  describe('assinar e trocar de plano', () => {
    it('usa e-mail e nome do banco, não do token', async () => {
      await controller.createSubscription(user(), {
        planType: 'PLUS',
        billingPeriod: 'MONTHLY',
      });

      expect(subscriptions.create).toHaveBeenCalledWith(
        'u1',
        'a@x.com',
        'Ana',
        {
          planType: 'PLUS',
          billingPeriod: 'MONTHLY',
        },
      );
    });

    it('sem nome, "Usuário"; sem e-mail, recusa assinar e trocar', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        email: 'a@x.com',
        firstName: null,
        lastName: null,
      });
      await controller.createSubscription(user(), { planType: 'FREE' });
      expect(subscriptions.create).toHaveBeenCalledWith(
        'u1',
        'a@x.com',
        'Usuário',
        {
          planType: 'FREE',
        },
      );

      prisma.user.findUniqueOrThrow.mockResolvedValue({ email: null });
      await expect(
        controller.createSubscription(user(), { planType: 'FREE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.upgradeSubscription(user(), { newPlanType: 'MAESTRO' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('troca de plano leva o e-mail do banco', async () => {
      await controller.upgradeSubscription(user(), { newPlanType: 'MAESTRO' });

      expect(subscriptions.upgrade).toHaveBeenCalledWith('u1', 'a@x.com', {
        newPlanType: 'MAESTRO',
      });
    });
  });

  it('retorno do Stripe exige session_id e confirma', async () => {
    await expect(
      controller.confirmStripeSuccess(undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(controller.confirmStripeSuccess('cs_1')).resolves.toEqual({
      success: true,
    });
    expect(subscriptions.confirmCheckoutSession).toHaveBeenCalledWith('cs_1');
  });

  describe('portal de cobrança', () => {
    it('sem cliente no Stripe é 404', async () => {
      await expect(controller.openBillingPortal(user())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('abre o portal com volta para o front', async () => {
      subscriptions.getCurrentSubscription.mockResolvedValue({
        stripeCustomerId: 'cus_1',
      });

      await expect(controller.openBillingPortal(user())).resolves.toEqual({
        success: true,
        url: 'https://portal',
      });
      expect(stripe.createBillingPortalSession).toHaveBeenCalledWith(
        'cus_1',
        expect.stringContaining('http'),
      );
    });
  });

  it('nota fiscal: admin passa como admin; o HTML vai direto na resposta', async () => {
    await controller.getInvoice(user(1), 'inv-1');
    expect(invoices.getDetail).toHaveBeenCalledWith('u1', true, 'inv-1');

    const res = { send: jest.fn() } as unknown as Response;
    await controller.getInvoiceHtml(user(0), 'inv-1', res);
    expect(invoices.getHtml).toHaveBeenCalledWith('u1', false, 'inv-1');
    expect(res.send).toHaveBeenCalledWith('<html>');
  });
});

describe('WebhookController', () => {
  let stripe: { constructWebhookEvent: jest.Mock };
  let webhook: { handleEvent: jest.Mock };
  let controller: WebhookController;
  const req = (rawBody?: Buffer) => ({ rawBody }) as never;

  beforeEach(() => {
    stripe = {
      constructWebhookEvent: jest.fn().mockReturnValue({ id: 'evt_1' }),
    };
    webhook = { handleEvent: jest.fn().mockResolvedValue(undefined) };
    controller = new WebhookController(
      stripe as unknown as StripeService,
      webhook as unknown as WebhookService,
    );
  });

  it('sem assinatura ou sem corpo cru é 400', async () => {
    await expect(
      controller.handleStripeWebhook(req(Buffer.from('{}'))),
    ).rejects.toThrow('Assinatura do webhook ausente');
    await expect(
      controller.handleStripeWebhook(req(), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assinatura inválida é 400 e não processa nada', async () => {
    stripe.constructWebhookEvent.mockImplementation(() => {
      throw new Error('No signatures found');
    });

    await expect(
      controller.handleStripeWebhook(req(Buffer.from('{}')), 'sig'),
    ).rejects.toThrow('Assinatura inválida');
    expect(webhook.handleEvent).not.toHaveBeenCalled();
  });

  it('evento válido é processado', async () => {
    await expect(
      controller.handleStripeWebhook(req(Buffer.from('{}')), 'sig'),
    ).resolves.toEqual({ received: true });
    expect(webhook.handleEvent).toHaveBeenCalledWith({ id: 'evt_1' });
  });
});

describe('CronController', () => {
  it('roda a manutenção e devolve o resultado com a hora', async () => {
    const results = { trialsExpired: 1, errors: [] };
    const cron = { checkSubscriptions: jest.fn().mockResolvedValue(results) };
    const controller = new CronController(
      cron as unknown as SubscriptionsCronService,
    );

    await expect(controller.checkSubscriptions()).resolves.toEqual({
      success: true,
      timestamp: expect.any(String),
      results,
    });
  });
});
