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
          locale: 'pt',
          metadata: {
            userId: 'u1',
            planType: 'MENTOR',
            billingPeriod: 'YEARLY',
          },
        }),
      );
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
