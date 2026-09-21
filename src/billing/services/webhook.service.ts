import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

type StripeInvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

/**
 * Processa eventos do webhook do Stripe — consolida em um único handler as
 * **três** implementações duplicadas e inconsistentes que existiam no legado
 * (`webhook/route.ts`, `payment/webhook/route.ts`, `webhook/stripe/route.ts`),
 * cada uma reagindo de forma diferente aos mesmos eventos (uma delas era só
 * um stub que logava e não fazia nada). Ver Fase 2G do ROADMAP para o
 * detalhamento de cada divergência encontrada.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Ponto de entrada do webhook, com trava de idempotência.
   *
   * O Stripe garante entrega *at-least-once* e reentrega por até 3 dias
   * enquanto não receber 2xx — ou seja, o mesmo `event.id` chega mais de uma
   * vez no caminho feliz e no caminho de erro. Sem esta trava, uma reentrega
   * de `invoice.payment_failed` criava uma segunda linha em `Payment`.
   *
   * A reserva é feita ANTES de processar: o `@unique` em `eventId` faz a
   * corrida entre duas entregas simultâneas ser resolvida pelo banco (a
   * segunda recebe P2002 e sai). Se o processamento falhar, a reserva é
   * desfeita para que a reentrega do Stripe possa tentar de novo.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    const reserved = await this.reserveEvent(event);

    if (!reserved) {
      this.logger.log(
        `Evento Stripe ${event.id} (${event.type}) já processado — ignorado`,
      );
      return;
    }

    try {
      await this.dispatch(event);
    } catch (error) {
      // Libera a trava para que a reentrega do Stripe reprocesse o evento.
      await this.releaseEvent(event.id);
      throw error;
    }
  }

  /**
   * @returns `true` se este processo ganhou o direito de processar o evento.
   */
  private async reserveEvent(event: Stripe.Event): Promise<boolean> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: {
          eventId: event.id,
          provider: 'stripe',
          eventType: event.type,
        },
      });

      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }

      throw error;
    }
  }

  private async releaseEvent(eventId: string): Promise<void> {
    await this.prisma.processedWebhookEvent
      .deleteMany({ where: { eventId } })
      .catch(() => undefined);
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    this.logger.log(`Evento Stripe recebido: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        await this.subscriptionsService.confirmCheckoutSession(session.id);
        break;
      }

      case 'invoice.payment_failed': {
        await this.handlePaymentFailed(
          event.data.object as StripeInvoiceWithSubscription,
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        await this.prisma.subscription.updateMany({
          where: { stripeSubscriptionId: stripeSub.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            autoRenew: false,
          },
        });
        break;
      }

      default:
        this.logger.debug(`Evento Stripe ignorado: ${event.type}`);
    }
  }

  private async handlePaymentFailed(
    invoice: StripeInvoiceWithSubscription,
  ): Promise<void> {
    const stripeSubscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!stripeSubscriptionId) {
      this.logger.warn(
        'invoice.payment_failed sem subscription associada, ignorando',
      );
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(
        `Assinatura não encontrada para stripeSubscriptionId=${stripeSubscriptionId}`,
      );
      return;
    }

    await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: (invoice.amount_due ?? 0) / 100,
        finalAmount: (invoice.amount_due ?? 0) / 100,
        currency: (invoice.currency ?? 'brl').toUpperCase(),
        status: 'REJECTED',
      },
    });

    // PAST_DUE em vez de EXPIRED direto: o Stripe normalmente tenta cobrar de
    // novo antes de desistir — a expiração definitiva fica a cargo do cron
    // (`check-subscriptions`) ou do evento `customer.subscription.deleted`.
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'PAST_DUE' },
    });
  }
}
