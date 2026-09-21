import { escapeRegex } from '../../../common/utils/regex.util';
import { Injectable, Logger } from '@nestjs/common';
import { EmailEventType, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { errorMessage } from '../../../common/utils/error.util';
import { deliveryRate, rate } from '../newsletter-rates';
import {
  COUNTER_BY_EVENT,
  DeliveryEvent,
  isPermanentBounce,
} from './delivery-event';

export interface IngestResult {
  received: number;
  applied: number;
  /** Já processados antes — reentrega do provedor. */
  duplicates: number;
  /** Sem par no banco: envio de outro sistema, ou anterior a este registro. */
  unmatched: number;
}

/**
 * Recebe os eventos de entrega do provedor de e-mail.
 *
 * **É isto que dá sentido a `emailsDelivered` e à taxa de entrega.** Até aqui
 * os dois existiam no schema sem ninguém para escrevê-los: o disparo
 * incrementava `emailsSent` — o que o servidor de saída aceitou — e nada mais.
 * O legado resolvia copiando `emailsSent` para `emailsDelivered` no fim do
 * envio, com o comentário "assumindo entrega imediata", o que produzia **100%
 * de entrega em toda campanha**, inclusive nas que caíram inteiras no spam.
 *
 * O caminho é o mesmo do webhook do Stripe, e pelas mesmas razões: **reserva
 * antes de processar**, com a unicidade do banco como trava, e devolve a
 * reserva se o processamento falhar — para a reentrega do provedor ter uma
 * segunda chance em vez de o evento sumir.
 */
@Injectable()
export class EmailEventsService {
  private readonly logger = new Logger(EmailEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    provider: string,
    events: DeliveryEvent[],
  ): Promise<IngestResult> {
    const result: IngestResult = {
      received: events.length,
      applied: 0,
      duplicates: 0,
      unmatched: 0,
    };

    for (const event of events) {
      const reserved = await this.reserve(provider, event);

      if (!reserved) {
        result.duplicates += 1;
        continue;
      }

      try {
        const applied = await this.apply(event);

        if (applied) {
          result.applied += 1;
        } else {
          result.unmatched += 1;
        }
      } catch (error: unknown) {
        // Libera a trava para o provedor reentregar.
        await this.release(event.providerEventId);

        this.logger.error(
          `Evento ${event.providerEventId} (${event.type}) falhou: ${errorMessage(error)}`,
        );

        throw error;
      }
    }

    this.logger.log(
      `Eventos de ${provider}: ${result.applied} aplicados, ` +
        `${result.duplicates} repetidos, ${result.unmatched} sem par`,
    );

    return result;
  }

  // -------------------------------------------------------------------

  /** @returns `true` se este processo ganhou o direito de processar. */
  private async reserve(
    provider: string,
    event: DeliveryEvent,
  ): Promise<boolean> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: {
          eventId: `${provider}:${event.providerEventId}`,
          provider,
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

  private async release(providerEventId: string): Promise<void> {
    await this.prisma.processedWebhookEvent
      .deleteMany({
        where: { eventId: { endsWith: escapeRegex(providerEventId) } },
      })
      .catch(() => undefined);
  }

  /** @returns `false` quando o evento não casa com nenhum envio conhecido. */
  private async apply(event: DeliveryEvent): Promise<boolean> {
    const match = await this.locate(event);

    if (!match) {
      return false;
    }

    await this.prisma.newsletterEmailEvent.create({
      data: {
        eventType: event.type,
        subscriberId: match.subscriberId,
        campaignId: match.campaignId,
        timestamp: event.timestamp,
        eventData: (event.data ?? {}) as Prisma.InputJsonValue,
      },
    });

    if (match.campaignId) {
      await this.bumpCampaign(match.campaignId, event.type);
    }

    await this.touchSubscriber(match.subscriberId, event);

    return true;
  }

  /**
   * De quem é este evento.
   *
   * Pelo id da mensagem primeiro — é o par exato, gravado no disparo. Pelo
   * endereço como reserva, para o evento de um e-mail transacional (confirmação
   * de conta, recuperação de senha) não se perder: ele não pertence a campanha
   * nenhuma, mas um retorno permanente ali importa tanto quanto na newsletter.
   */
  private async locate(
    event: DeliveryEvent,
  ): Promise<{ subscriberId: string; campaignId: string | null } | null> {
    if (event.messageId) {
      const send = await this.prisma.newsletterCampaignSend.findFirst({
        where: { emailId: event.messageId },
        select: { subscriberId: true, campaignId: true },
      });

      if (send) {
        return send;
      }
    }

    if (!event.email) {
      return null;
    }

    const subscriber = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: event.email.toLowerCase() },
      select: { id: true },
    });

    return subscriber
      ? { subscriberId: subscriber.id, campaignId: null }
      : null;
  }

  /**
   * Soma o contador e recalcula as taxas.
   *
   * As taxas são recalculadas **a partir dos contadores**, não incrementadas:
   * uma taxa que se acumula sozinha diverge dos números que a explicam no
   * primeiro evento perdido ou repetido.
   */
  private async bumpCampaign(
    campaignId: string,
    type: EmailEventType,
  ): Promise<void> {
    const counter = COUNTER_BY_EVENT[type];

    if (!counter) {
      return;
    }

    const campaign = await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: { [counter]: { increment: 1 } },
      select: {
        emailsSent: true,
        emailsDelivered: true,
        emailsOpened: true,
        emailsClicked: true,
        emailsBounced: true,
        emailsUnsubscribed: true,
      },
    });

    await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: {
        // A taxa de entrega tem regra própria: "zero entregue" só é 0% quando
        // o provedor reportou alguma coisa. Ver `newsletter-rates`.
        deliveryRate: deliveryRate(
          campaign.emailsDelivered,
          campaign.emailsSent,
          campaign.emailsBounced,
        ),
        openRate: rate(campaign.emailsOpened, campaign.emailsDelivered),
        clickRate: rate(campaign.emailsClicked, campaign.emailsDelivered),
        bounceRate: rate(campaign.emailsBounced, campaign.emailsSent),
        unsubscribeRate: rate(
          campaign.emailsUnsubscribed,
          campaign.emailsDelivered,
        ),
      },
    });
  }

  /**
   * Atualiza o assinante.
   *
   * **Retorno permanente e denúncia de spam tiram da lista.** Continuar
   * mandando para um endereço que não existe, ou para quem apertou "isto é
   * spam", é como a reputação do domínio de envio é destruída — e a partir daí
   * a newsletter cai na caixa de spam de quem *quer* recebê-la. Retorno
   * **temporário** (caixa cheia, servidor fora do ar) não desinscreve ninguém.
   */
  private async touchSubscriber(
    subscriberId: string,
    event: DeliveryEvent,
  ): Promise<void> {
    const data: Prisma.NewsletterSubscriberUpdateInput = {};

    if (event.type === EmailEventType.OPENED) {
      data.lastEmailOpenedAt = event.timestamp;
      data.emailOpenCount = { increment: 1 };
    }

    if (event.type === EmailEventType.CLICKED) {
      data.emailClickCount = { increment: 1 };
    }

    if (event.type === EmailEventType.COMPLAINED) {
      data.status = SubscriptionStatus.BLOCKED;
      data.unsubscribedAt = event.timestamp;
      data.unsubscribeReason = 'Denúncia de spam';
    }

    if (event.type === EmailEventType.UNSUBSCRIBED) {
      data.status = SubscriptionStatus.UNSUBSCRIBED;
      data.unsubscribedAt = event.timestamp;
    }

    if (
      event.type === EmailEventType.BOUNCED &&
      isPermanentBounce(event.data)
    ) {
      data.status = SubscriptionStatus.BOUNCED;
      data.unsubscribedAt = event.timestamp;
      data.unsubscribeReason = 'Endereço inexistente';
    }

    if (Object.keys(data).length === 0) {
      return;
    }

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriberId },
      data,
    });
  }
}
