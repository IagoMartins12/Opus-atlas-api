import { EmailEventType } from '@prisma/client';

/**
 * Um evento de entrega, já normalizado.
 *
 * **Esta forma é o contrato, e o provedor é detalhe.** SendGrid, Resend,
 * Postmark e SES publicam o mesmo punhado de fatos — chegou, voltou, foi
 * aberto, foi marcado como spam — em quatro formatos diferentes, com quatro
 * esquemas de assinatura. O que muda entre eles é a tradução; o que se faz com
 * o evento depois é igual. Separar os dois é o que permite trocar de provedor
 * escrevendo um adaptador em vez de reescrever a contabilidade da campanha.
 */
export interface DeliveryEvent {
  /** Id do evento **no provedor** — é a chave de idempotência. */
  providerEventId: string;
  type: EmailEventType;
  /** Id da mensagem, como gravado em `NewsletterCampaignSend.emailId`. */
  messageId?: string;
  /** Endereço do destinatário — a reserva quando não há id de mensagem. */
  email?: string;
  timestamp: Date;
  /** O que o provedor disse a mais: motivo do retorno, agente, link clicado. */
  data?: Record<string, unknown>;
}

/**
 * Como cada evento mexe nos contadores da campanha.
 *
 * `SENT` não está aqui de propósito: `emailsSent` é escrito pelo próprio
 * disparo, que é quem sabe quantos foram para a fila. Contá-lo de novo pelo
 * webhook somaria duas vezes o mesmo envio.
 */
export const COUNTER_BY_EVENT: Partial<Record<EmailEventType, string>> = {
  DELIVERED: 'emailsDelivered',
  OPENED: 'emailsOpened',
  CLICKED: 'emailsClicked',
  BOUNCED: 'emailsBounced',
  COMPLAINED: 'emailsComplained',
  UNSUBSCRIBED: 'emailsUnsubscribed',
};

/**
 * Eventos que tiram o assinante da lista.
 *
 * **Retorno permanente e denúncia de spam desinscrevem.** Continuar mandando
 * para um endereço que voltou, ou para quem apertou "isto é spam", é como a
 * reputação do domínio de envio é destruída — e a partir daí a newsletter
 * inteira passa a cair na caixa de spam de quem *quer* recebê-la.
 */
export const UNSUBSCRIBING_EVENTS: EmailEventType[] = [
  EmailEventType.BOUNCED,
  EmailEventType.COMPLAINED,
  EmailEventType.UNSUBSCRIBED,
];

/**
 * Um retorno **temporário** não desinscreve ninguém.
 *
 * Caixa cheia, servidor fora do ar por uma hora, greylisting: o endereço
 * continua válido. Só o retorno permanente — endereço que não existe — tira o
 * assinante da lista. Tratar os dois iguais esvaziaria a base a cada
 * instabilidade do destinatário.
 */
export function isPermanentBounce(data?: Record<string, unknown>): boolean {
  const kind = String(data?.bounceType ?? data?.type ?? '').toLowerCase();

  if (!kind) {
    // Sem classificação, o provedor não disse: o conservador é não desinscrever.
    return false;
  }

  return kind.includes('hard') || kind.includes('permanent');
}
