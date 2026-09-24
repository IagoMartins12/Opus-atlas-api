import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { WebhookService } from './webhook.service';

type PrismaMock = {
  processedWebhookEvent: {
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  payment: { create: jest.Mock };
  subscription: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

/** Erro de violação de unique, como o Prisma o lança de verdade. */
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const makeEvent = (type: string, data: unknown, id = 'evt_1'): Stripe.Event =>
  ({ id, type, data: { object: data } }) as unknown as Stripe.Event;

describe('WebhookService', () => {
  let service: WebhookService;
  let prisma: PrismaMock;
  let subscriptions: {
    confirmCheckoutSession: jest.Mock;
    registerRenewal: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      processedWebhookEvent: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: { create: jest.fn().mockResolvedValue({}) },
      subscription: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    subscriptions = {
      confirmCheckoutSession: jest.fn().mockResolvedValue({}),
      registerRenewal: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();

    service = module.get(WebhookService);
  });

  describe('idempotência', () => {
    it('processa o evento na primeira entrega', async () => {
      const event = makeEvent('checkout.session.completed', {
        id: 'cs_1',
        mode: 'subscription',
      });

      await service.handleEvent(event);

      expect(prisma.processedWebhookEvent.create).toHaveBeenCalledWith({
        data: {
          eventId: 'evt_1',
          provider: 'stripe',
          eventType: 'checkout.session.completed',
        },
      });
      expect(subscriptions.confirmCheckoutSession).toHaveBeenCalledWith('cs_1');
    });

    it('ignora reentrega do mesmo evento sem reprocessar', async () => {
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        uniqueViolation(),
      );

      await service.handleEvent(
        makeEvent('checkout.session.completed', {
          id: 'cs_1',
          mode: 'subscription',
        }),
      );

      expect(subscriptions.confirmCheckoutSession).not.toHaveBeenCalled();
    });

    it('não duplica linha de pagamento quando o Stripe reentrega uma falha', async () => {
      const event = makeEvent('invoice.payment_failed', {
        subscription: 'sub_1',
        amount_due: 2500,
        currency: 'brl',
      });

      prisma.subscription.findFirst.mockResolvedValue({ id: 'local_sub_1' });

      // Primeira entrega: processa e grava o pagamento.
      await service.handleEvent(event);
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);

      // Reentrega: a trava de idempotência barra antes de gravar de novo.
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        uniqueViolation(),
      );
      await service.handleEvent(event);

      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it('libera a trava quando o processamento falha, para o Stripe poder reentregar', async () => {
      subscriptions.confirmCheckoutSession.mockRejectedValueOnce(
        new Error('Stripe fora do ar'),
      );

      await expect(
        service.handleEvent(
          makeEvent('checkout.session.completed', {
            id: 'cs_1',
            mode: 'subscription',
          }),
        ),
      ).rejects.toThrow('Stripe fora do ar');

      expect(prisma.processedWebhookEvent.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'evt_1' },
      });
    });

    it('propaga erro de banco que não seja violação de unique', async () => {
      prisma.processedWebhookEvent.create.mockRejectedValueOnce(
        new Error('conexão perdida'),
      );

      await expect(
        service.handleEvent(makeEvent('invoice.payment_failed', {})),
      ).rejects.toThrow('conexão perdida');
    });
  });

  describe('invoice.payment_failed', () => {
    beforeEach(() => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'local_sub_1' });
    });

    it('grava o pagamento como REJECTED e marca a assinatura como PAST_DUE', async () => {
      await service.handleEvent(
        makeEvent('invoice.payment_failed', {
          subscription: 'sub_1',
          amount_due: 4990,
          currency: 'usd',
        }),
      );

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          subscriptionId: 'local_sub_1',
          amount: 49.9,
          finalAmount: 49.9,
          currency: 'USD',
          status: 'REJECTED',
        },
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'local_sub_1' },
        data: { status: 'PAST_DUE' },
      });
    });

    it('resolve a assinatura quando o Stripe manda o objeto expandido', async () => {
      await service.handleEvent(
        makeEvent('invoice.payment_failed', {
          subscription: { id: 'sub_expandido' },
          amount_due: 1000,
          currency: 'brl',
        }),
      );

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_expandido' },
      });
    });

    it('não grava nada quando a fatura não tem assinatura associada', async () => {
      await service.handleEvent(
        makeEvent('invoice.payment_failed', { amount_due: 1000 }),
      );

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('não grava nada quando a assinatura não existe localmente', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleEvent(
        makeEvent('invoice.payment_failed', {
          subscription: 'sub_desconhecida',
          amount_due: 1000,
          currency: 'brl',
        }),
      );

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  /**
   * A renovação — o evento que faltava. Sem ele, `endDate` nunca avançava do
   * que o checkout gravou e o cron expirava quem estava pagando em dia.
   */
  describe('invoice.paid', () => {
    const fatura = (extra: Record<string, unknown> = {}) => ({
      id: 'in_1',
      subscription: 'sub_1',
      billing_reason: 'subscription_cycle',
      amount_paid: 3990,
      currency: 'brl',
      lines: { data: [{ period: { end: 1790000000 } }] },
      ...extra,
    });

    it('registra a renovação com o fim de ciclo que o Stripe mandou', async () => {
      await service.handleEvent(makeEvent('invoice.paid', fatura()));

      expect(subscriptions.registerRenewal).toHaveBeenCalledWith({
        id: 'in_1',
        stripeSubscriptionId: 'sub_1',
        amountPaid: 39.9,
        currency: 'brl',
        periodEnd: new Date(1790000000 * 1000),
      });
    });

    it('não registra a primeira fatura: quem a trata é o checkout', async () => {
      // As duas juntas gravariam o mesmo pagamento duas vezes.
      await service.handleEvent(
        makeEvent(
          'invoice.paid',
          fatura({ billing_reason: 'subscription_create' }),
        ),
      );

      expect(subscriptions.registerRenewal).not.toHaveBeenCalled();
    });

    it('resolve a assinatura quando o Stripe manda o objeto expandido', async () => {
      await service.handleEvent(
        makeEvent('invoice.paid', fatura({ subscription: { id: 'sub_9' } })),
      );

      expect(subscriptions.registerRenewal).toHaveBeenCalledWith(
        expect.objectContaining({ stripeSubscriptionId: 'sub_9' }),
      );
    });

    it('ignora fatura sem assinatura associada', async () => {
      await service.handleEvent(
        makeEvent('invoice.paid', fatura({ subscription: null })),
      );

      expect(subscriptions.registerRenewal).not.toHaveBeenCalled();
    });

    it('sem linha de período, deixa a data a cargo do serviço', async () => {
      await service.handleEvent(
        makeEvent('invoice.paid', fatura({ lines: { data: [] } })),
      );

      expect(subscriptions.registerRenewal).toHaveBeenCalledWith(
        expect.objectContaining({ periodEnd: null }),
      );
    });
  });

  describe('outros eventos', () => {
    it('cancela a assinatura em customer.subscription.deleted', async () => {
      await service.handleEvent(
        makeEvent('customer.subscription.deleted', { id: 'sub_1' }),
      );

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeSubscriptionId: 'sub_1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('ignora checkout que não seja de assinatura', async () => {
      await service.handleEvent(
        makeEvent('checkout.session.completed', {
          id: 'cs_1',
          mode: 'payment',
        }),
      );

      expect(subscriptions.confirmCheckoutSession).not.toHaveBeenCalled();
    });

    it('não quebra com evento desconhecido', async () => {
      await expect(
        service.handleEvent(makeEvent('customer.created', {})),
      ).resolves.toBeUndefined();
    });
  });
});
