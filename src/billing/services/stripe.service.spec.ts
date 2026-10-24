import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('StripeService', () => {
  it('sem chave, recusa com a variável que falta', () => {
    const service = new StripeService(configWith({}));

    expect(() => service.getClient()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('cliente é criado uma vez só', () => {
    const service = new StripeService(
      configWith({ 'billing.stripeSecretKey': 'sk_test_x' }),
    );

    expect(service.getClient()).toBe(service.getClient());
  });

  // O legado criava Product/Price novo a cada checkout.
  it('usa o Price ID configurado, e diz qual falta', () => {
    const service = new StripeService(
      configWith({ 'billing.priceIds.PLUS.MONTHLY': 'price_plus_m' }),
    );

    expect(service.getPriceId('PLUS', 'MONTHLY')).toBe('price_plus_m');
    expect(() => service.getPriceId('PLUS', 'YEARLY')).toThrow(
      'Price ID do Stripe não configurado para PLUS/YEARLY',
    );
  });

  describe('com o cliente do Stripe', () => {
    const stripe = {
      checkout: { sessions: { create: jest.fn(), retrieve: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      webhooks: { constructEvent: jest.fn() },
      subscriptions: {
        update: jest.fn(),
        cancel: jest.fn(),
        retrieve: jest.fn(),
      },
      invoicePayments: { list: jest.fn() },
      paymentIntents: { retrieve: jest.fn() },
    };
    let service: StripeService;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new StripeService(
        configWith({
          'billing.priceIds.MENTOR.YEARLY': 'price_mentor_y',
          'billing.stripeWebhookSecret': 'whsec_x',
        }),
      );
      jest
        .spyOn(service, 'getClient')
        .mockReturnValue(
          stripe as unknown as ReturnType<StripeService['getClient']>,
        );
    });

    it('checkout de assinatura com o preço e os metadados do plano', async () => {
      await service.createCheckoutSession({
        userId: 'u1',
        userEmail: 'a@x.com',
        planType: 'MENTOR',
        billingPeriod: 'YEARLY',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
      });

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer_email: 'a@x.com',
          line_items: [{ price: 'price_mentor_y', quantity: 1 }],
          locale: 'pt-BR',
          metadata: {
            userId: 'u1',
            planType: 'MENTOR',
            billingPeriod: 'YEARLY',
          },
        }),
      );
      const [args] = stripe.checkout.sessions.create.mock.calls[0];
      expect(args.subscription_data.trial_period_days).toBeUndefined();
    });

    it('com teste: o Stripe pede o cartão e só cobra no fim do teste', async () => {
      await service.createCheckoutSession({
        userId: 'u1',
        userEmail: 'a@x.com',
        planType: 'MENTOR',
        billingPeriod: 'YEARLY',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
        trialDays: 14,
      });

      const [args] = stripe.checkout.sessions.create.mock.calls[0];
      expect(args.payment_method_collection).toBe('always');
      expect(args.subscription_data).toMatchObject({
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      });
    });

    it('quem já é cliente no Stripe volta como o mesmo cliente', async () => {
      await service.createCheckoutSession({
        userId: 'u1',
        userEmail: 'a@x.com',
        planType: 'MENTOR',
        billingPeriod: 'YEARLY',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
        customerId: 'cus_1',
      });

      const [args] = stripe.checkout.sessions.create.mock.calls[0];
      expect(args.customer).toBe('cus_1');
      expect(args.customer_email).toBeUndefined();
    });

    it('cancelar no fim do período e desfazer', async () => {
      await service.setCancelAtPeriodEnd('sub_1', true);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        cancel_at_period_end: true,
      });
    });

    it('encerrar agora tolera assinatura que o Stripe já encerrou', async () => {
      stripe.subscriptions.cancel.mockRejectedValueOnce(
        Object.assign(new Error('No such subscription'), {
          code: 'resource_missing',
        }),
      );
      await expect(service.cancelSubscriptionNow('sub_1')).resolves.toBe(
        undefined,
      );

      stripe.subscriptions.cancel.mockRejectedValueOnce(new Error('rede'));
      await expect(service.cancelSubscriptionNow('sub_1')).rejects.toThrow(
        'rede',
      );
    });

    it('descida agendada troca o preço sem cobrança proporcional', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: 'si_1' }] },
      });

      await service.changePriceAtRenewal('sub_1', 'price_plus');

      expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        items: [{ id: 'si_1', price: 'price_plus' }],
        proration_behavior: 'none',
      });
    });

    it('portal de cobrança e leitura da sessão', async () => {
      await service.createBillingPortalSession('cus_1', 'https://volta');
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://volta',
      });

      await service.retrieveCheckoutSession('cs_1');
      expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_1', {
        expand: ['subscription', 'customer'],
      });
    });

    describe('taxa cobrada pelo Stripe', () => {
      const intent = (fee: number | null, currency = 'brl') => ({
        latest_charge: {
          balance_transaction: fee === null ? null : { fee, currency },
        },
      });

      it('fatura: a taxa vem da transação de saldo da cobrança', async () => {
        stripe.invoicePayments.list.mockResolvedValue({
          data: [{ payment: { payment_intent: 'pi_1' } }],
        });
        stripe.paymentIntents.retrieve.mockResolvedValue(intent(198));

        expect(await service.feeForInvoice('in_1')).toEqual({
          feeCents: 198,
          currency: 'BRL',
          paymentIntentId: 'pi_1',
        });
        expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', {
          expand: ['latest_charge.balance_transaction'],
        });
      });

      it('mais de uma cobrança na fatura: soma as taxas', async () => {
        stripe.invoicePayments.list.mockResolvedValue({
          data: [
            { payment: { payment_intent: 'pi_1' } },
            { payment: { payment_intent: { id: 'pi_2' } } },
          ],
        });
        stripe.paymentIntents.retrieve
          .mockResolvedValueOnce(intent(100))
          .mockResolvedValueOnce(intent(50));

        expect(await service.feeForInvoice('in_1')).toMatchObject({
          feeCents: 150,
          paymentIntentId: 'pi_1',
        });
      });

      it('sem cobrança (fatura zerada) ou sem transação ainda: nulo, não zero', async () => {
        stripe.invoicePayments.list.mockResolvedValue({ data: [] });
        expect(await service.feeForInvoice('in_0')).toBeNull();

        stripe.invoicePayments.list.mockResolvedValue({
          data: [{ payment: { payment_intent: 'pi_1' } }],
        });
        stripe.paymentIntents.retrieve.mockResolvedValue(intent(null));
        expect(await service.feeForInvoice('in_1')).toBeNull();
      });

      it('a moeda da taxa vem da transação de saldo, em maiúsculas', async () => {
        stripe.invoicePayments.list.mockResolvedValue({
          data: [{ payment: { payment_intent: 'pi_1' } }],
        });
        stripe.paymentIntents.retrieve.mockResolvedValue(intent(500, 'usd'));

        expect(await service.feeForInvoice('in_1')).toMatchObject({
          feeCents: 500,
          currency: 'USD',
        });
      });

      it('do PaymentIntent de volta à fatura (para reembolso e contestação)', async () => {
        stripe.invoicePayments.list.mockResolvedValue({
          data: [{ invoice: 'in_7' }],
        });
        expect(await service.invoiceIdForPaymentIntent('pi_7')).toBe('in_7');
        expect(stripe.invoicePayments.list).toHaveBeenCalledWith({
          payment: { type: 'payment_intent', payment_intent: 'pi_7' },
          limit: 1,
        });

        stripe.invoicePayments.list.mockResolvedValue({ data: [] });
        expect(await service.invoiceIdForPaymentIntent('pi_8')).toBeNull();

        stripe.invoicePayments.list.mockRejectedValue(new Error('rede'));
        expect(await service.invoiceIdForPaymentIntent('pi_9')).toBeNull();
      });

      it('erro do Stripe não derruba quem chama', async () => {
        stripe.invoicePayments.list.mockRejectedValue(new Error('rede'));

        expect(await service.feeForInvoice('in_1')).toBeNull();
      });

      it('sessão de assinatura vai pela fatura; a avulsa, pelo PaymentIntent', async () => {
        stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
          invoice: 'in_9',
        });
        stripe.invoicePayments.list.mockResolvedValue({
          data: [{ payment: { payment_intent: 'pi_9' } }],
        });
        stripe.paymentIntents.retrieve.mockResolvedValue(intent(77));
        expect(await service.feeForSession('cs_1')).toMatchObject({
          feeCents: 77,
        });

        stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
          invoice: null,
          payment_intent: 'pi_5',
        });
        stripe.paymentIntents.retrieve.mockResolvedValue(intent(33));
        expect(await service.feeForSession('cs_2')).toMatchObject({
          feeCents: 33,
          paymentIntentId: 'pi_5',
        });
      });
    });

    it('webhook é validado com o segredo configurado', () => {
      const body = Buffer.from('{}');

      service.constructWebhookEvent(body, 'sig');

      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
        body,
        'sig',
        'whsec_x',
      );
    });

    it('sem segredo de webhook, recusa — nunca um valor fixo no código', () => {
      const bare = new StripeService(configWith({}));

      expect(() =>
        bare.constructWebhookEvent(Buffer.from('{}'), 'sig'),
      ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });
  });
});
