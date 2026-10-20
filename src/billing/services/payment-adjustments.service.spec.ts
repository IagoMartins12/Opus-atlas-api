import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentAdjustmentsService } from './payment-adjustments.service';
import { StripeService } from './stripe.service';

const at = new Date('2026-11-12T12:00:00Z');
const money = (over: Record<string, unknown> = {}) => ({
  id: 're_1',
  paymentIntentId: 'pi_1',
  amountCents: 3_990,
  currency: 'brl',
  at,
  ...over,
});

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'x',
  });

describe('PaymentAdjustmentsService', () => {
  let prisma: {
    payment: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    paymentAdjustment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let stripe: { invoiceIdForPaymentIntent: jest.Mock };
  let service: PaymentAdjustmentsService;

  beforeEach(() => {
    prisma = {
      payment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ finalAmount: 39.9, status: 'APPROVED' }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentAdjustment: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ amountCents: 3_990 }]),
      },
    };
    stripe = { invoiceIdForPaymentIntent: jest.fn().mockResolvedValue(null) };
    service = new PaymentAdjustmentsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
    );
  });

  describe('reembolso', () => {
    it('grava o ajuste ligado ao pagamento, em maiúsculas e com o instante do dinheiro', async () => {
      prisma.paymentAdjustment.findMany.mockResolvedValue([
        { amountCents: 1_000 },
      ]);

      await service.registerRefund(money({ amountCents: 1_000 }));

      expect(prisma.paymentAdjustment.create).toHaveBeenCalledWith({
        data: {
          kind: 'REFUND',
          stripeRef: 're_1',
          paymentId: 'pay-1',
          amountCents: 1_000,
          currency: 'BRL',
          at,
        },
      });
      expect(prisma.payment.findFirst).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_1' },
        select: { id: true },
      });
    });

    it('reembolso total marca o pagamento como reembolsado; parcial, não', async () => {
      await service.registerRefund(money());
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'REFUNDED' },
      });

      prisma.payment.update.mockClear();
      prisma.paymentAdjustment.findMany.mockResolvedValue([
        { amountCents: 1_000 },
      ]);
      await service.registerRefund(money({ id: 're_2', amountCents: 1_000 }));
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('vários reembolsos parciais que somam o total também marcam', async () => {
      prisma.paymentAdjustment.findMany.mockResolvedValue([
        { amountCents: 2_000 },
        { amountCents: 1_990 },
      ]);

      await service.registerRefund(money({ id: 're_3', amountCents: 1_990 }));

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'REFUNDED' },
      });
    });

    // O Stripe reentrega webhooks: a mesma referência conta uma vez só.
    it('o mesmo reembolso chegando de novo não conta nem mexe no pagamento', async () => {
      prisma.paymentAdjustment.create.mockRejectedValue(duplicate());

      await service.registerRefund(money());

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    // Sem o índice único (deploy sem `db push`), a referência repetida
    // ainda não pode contar duas vezes.
    it('referência já gravada é ignorada mesmo sem o índice único do banco', async () => {
      prisma.paymentAdjustment.findFirst.mockResolvedValue({ id: 'ja-tem' });

      await service.registerRefund(money());

      expect(prisma.paymentAdjustment.create).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('outro erro do banco não é engolido', async () => {
      prisma.paymentAdjustment.create.mockRejectedValue(
        new Error('banco fora'),
      );

      await expect(service.registerRefund(money())).rejects.toThrow(
        'banco fora',
      );
    });
  });

  describe('contestação', () => {
    it('aberta: o valor e a tarifa, cada um com a sua referência', async () => {
      await service.registerDisputeOpened(
        money({ id: 'dp_1', feeCents: 1_500 }) as never,
      );

      const kinds = prisma.paymentAdjustment.create.mock.calls.map(
        ([{ data }]) => [data.kind, data.stripeRef, data.amountCents],
      );
      expect(kinds).toEqual([
        ['DISPUTE', 'dp_1', 3_990],
        ['DISPUTE_FEE', 'dp_1:fee', 1_500],
      ]);
    });

    it('sem tarifa lida, só o valor', async () => {
      await service.registerDisputeOpened(
        money({ id: 'dp_1', feeCents: 0 }) as never,
      );

      expect(prisma.paymentAdjustment.create).toHaveBeenCalledTimes(1);
    });

    it('ganha: devolve o valor, com a referência própria', async () => {
      await service.registerDisputeWon(money({ id: 'dp_1' }));

      expect(prisma.paymentAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'DISPUTE_WON',
          stripeRef: 'dp_1:won',
        }),
      });
    });
  });

  describe('achar o pagamento', () => {
    it('pagamento anterior ao PaymentIntent gravado: acha pela fatura e já guarda o id', async () => {
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'pay-old' });
      stripe.invoiceIdForPaymentIntent.mockResolvedValue('in_9');

      await service.registerRefund(money());

      expect(prisma.payment.findFirst).toHaveBeenLastCalledWith({
        where: { stripeInvoiceId: 'in_9' },
        select: { id: true },
      });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-old' },
        data: { stripePaymentIntentId: 'pi_1' },
      });
      expect(
        prisma.paymentAdjustment.create.mock.calls[0][0].data.paymentId,
      ).toBe('pay-old');
    });

    // O dinheiro não pode sumir da contabilidade por falta de pagamento ligado.
    it('sem achar o pagamento, o ajuste vale mesmo assim', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await service.registerRefund(money());

      expect(
        prisma.paymentAdjustment.create.mock.calls[0][0].data.paymentId,
      ).toBeNull();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('sem PaymentIntent no evento, nem procura', async () => {
      await service.registerRefund(money({ paymentIntentId: null }));

      expect(prisma.payment.findFirst).not.toHaveBeenCalled();
      expect(prisma.paymentAdjustment.create).toHaveBeenCalled();
    });
  });
});
