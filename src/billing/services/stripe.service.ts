import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPeriod, PlanType } from '@prisma/client';
// `import = require`, e não `import Stripe from 'stripe'`: o pacote declara
// `export =` e o projeto compila sem `esModuleInterop`, então o import padrão
// virava `require('stripe').default` — que não existe. O build quebrava na
// primeira chamada ao Stripe (checkout, portal, webhook) com "is not a
// constructor"; o teste do serviço é que achou. A regra de lint proíbe
// `require` para empurrar o import ES, que é justamente o que não funciona aqui.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Stripe = require('stripe');

/**
 * Cliente Stripe compartilhado. Diferente do legado (`stripeClient.ts`), que
 * criava um `Product`/`Price` novo no Stripe a cada checkout — poluindo o
 * dashboard com dezenas de produtos "Opus Atlas - Plus" duplicados — este
 * serviço só usa Price IDs pré-criados no dashboard, configurados via env
 * (`STRIPE_PRICE_<PLANO>_<PERIODO>`).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  constructor(private readonly configService: ConfigService) {}

  getClient(): Stripe {
    if (this.client) {
      return this.client;
    }

    const secretKey = this.configService.get<string>('billing.stripeSecretKey');
    if (!secretKey) {
      throw new Error(
        'Stripe não configurado: STRIPE_SECRET_KEY/STRIPE_SECRET_KEY_TEST ausente',
      );
    }

    this.client = new Stripe(secretKey, { apiVersion: '2026-08-26.dahlia' });
    return this.client;
  }

  getPriceId(planType: PlanType, billingPeriod: BillingPeriod): string {
    const priceId = this.configService.get<string>(
      `billing.priceIds.${planType}.${billingPeriod}`,
    );

    if (!priceId) {
      throw new Error(
        `Price ID do Stripe não configurado para ${planType}/${billingPeriod}`,
      );
    }

    return priceId;
  }

  async createCheckoutSession(data: {
    userId: string;
    userEmail: string;
    planType: PlanType;
    billingPeriod: BillingPeriod;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const priceId = this.getPriceId(data.planType, data.billingPeriod);

    return this.getClient().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: data.userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
      locale: 'pt',
      metadata: {
        userId: data.userId,
        planType: data.planType,
        billingPeriod: data.billingPeriod,
      },
    });
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return this.getClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<Stripe.Checkout.Session> {
    return this.getClient().checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });
  }

  /** Valida a assinatura do webhook contra o body cru — nunca aceita um
   * segredo hardcoded (achado de segurança real no legado, ver Fase 2G do
   * ROADMAP: uma chave secreta do Stripe estava commitada no código-fonte
   * como "segredo" de webhook em pelo menos dois arquivos). */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.configService.get<string>(
      'billing.stripeWebhookSecret',
    );

    if (!webhookSecret) {
      throw new Error(
        'Stripe webhook secret não configurado: STRIPE_WEBHOOK_SECRET/STRIPE_WEBHOOK_SECRET_TEST ausente',
      );
    }

    return this.getClient().webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }
}
