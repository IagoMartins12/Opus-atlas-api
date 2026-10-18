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
 * serviço só usa Price IDs que já existem: os da versão vigente do preço
 * (`StripeCatalogService`, que cria um Price só quando o valor muda) e, sem
 * ela, os do ambiente (`STRIPE_PRICE_<PLANO>_<PERIODO>`).
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
    /** O Price vigente (`StripeCatalogService.priceIdFor`); sem ele, o do ambiente. */
    priceId?: string;
    /** O espelho do cupom no Stripe: é o que faz o desconto ser cobrado. */
    stripeCouponId?: string | null;
    /**
     * Teste grátis **do Stripe**: o cartão é pedido no checkout e a primeira
     * cobrança acontece no fim do teste. Antes o teste era só nosso — o plano
     * abria junto com o checkout, desistindo ou não, e o Stripe cobrava na hora.
     */
    trialDays?: number;
    /** Cliente do Stripe que a pessoa já tem: cartão e faturas no mesmo lugar. */
    customerId?: string | null;
  }): Promise<Stripe.Checkout.Session> {
    const priceId =
      data.priceId ?? this.getPriceId(data.planType, data.billingPeriod);
    const metadata = {
      userId: data.userId,
      planType: data.planType,
      billingPeriod: data.billingPeriod,
    };

    return this.getClient().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(data.customerId
        ? { customer: data.customerId }
        : { customer_email: data.userEmail }),
      line_items: [{ price: priceId, quantity: 1 }],
      ...(data.stripeCouponId
        ? { discounts: [{ coupon: data.stripeCouponId }] }
        : {}),
      // Com teste, o cartão é obrigatório mesmo sem nada a cobrar agora — é ele
      // que paga no fim do teste. Sem cartão no fim, o Stripe encerra.
      ...(data.trialDays
        ? {
            payment_method_collection: 'always' as const,
            subscription_data: {
              trial_period_days: data.trialDays,
              trial_settings: {
                end_behavior: { missing_payment_method: 'cancel' as const },
              },
              metadata,
            },
          }
        : { subscription_data: { metadata } }),
      success_url: data.successUrl,
      cancel_url: data.cancelUrl,
      locale: 'pt',
      metadata,
    });
  }

  /**
   * Cancelar no fim do período (ou do teste) — e desfazer isso ao reativar.
   * Sem esta chamada, o cancelamento existia só no nosso banco e o Stripe
   * seguia renovando e cobrando.
   */
  async setCancelAtPeriodEnd(
    stripeSubscriptionId: string,
    cancel: boolean,
  ): Promise<void> {
    await this.getClient().subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: cancel,
    });
  }

  /**
   * Encerra agora — cobrança recusada sem solução no prazo, ou a assinatura
   * substituída por um upgrade. Já encerrada no Stripe não é erro: o efeito
   * pedido já existe.
   */
  async cancelSubscriptionNow(stripeSubscriptionId: string): Promise<void> {
    try {
      await this.getClient().subscriptions.cancel(stripeSubscriptionId);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'resource_missing') return;
      const message = (error as Error).message ?? '';
      if (/canceled subscription/i.test(message)) return;
      throw error;
    }
  }

  /**
   * Troca o preço **a partir da próxima cobrança**, sem cobrança proporcional:
   * é a descida de plano agendada. O plano local muda quando essa fatura for
   * paga (`registerRenewal`).
   */
  async changePriceAtRenewal(
    stripeSubscriptionId: string,
    priceId: string,
  ): Promise<void> {
    const client = this.getClient();
    const subscription =
      await client.subscriptions.retrieve(stripeSubscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Assinatura ${stripeSubscriptionId} sem item de preço`);
    }
    await client.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'none',
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
