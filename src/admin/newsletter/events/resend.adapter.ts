import { createHmac, timingSafeEqual } from 'node:crypto';
import { EmailEventType } from '@prisma/client';
import { DeliveryEvent } from './delivery-event';

/**
 * Tradução dos eventos do Resend.
 *
 * O Resend publica sete tipos; cinco deles têm equivalente no nosso enum.
 * `email.delivery_delayed` **não entra**: atraso não é entrega nem retorno, e
 * contá-lo em qualquer um dos dois mentiria sobre a campanha.
 */
const TYPE_MAP: Record<string, EmailEventType> = {
  'email.sent': EmailEventType.SENT,
  'email.delivered': EmailEventType.DELIVERED,
  'email.opened': EmailEventType.OPENED,
  'email.clicked': EmailEventType.CLICKED,
  'email.bounced': EmailEventType.BOUNCED,
  'email.complained': EmailEventType.COMPLAINED,
};

interface ResendPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
    click?: { link?: string };
    [key: string]: unknown;
  };
}

/**
 * Converte o corpo de um webhook do Resend no evento normalizado.
 *
 * **O id do evento vem do cabeçalho, não do corpo.** O Resend assina com Svix,
 * e `svix-id` é o identificador único da entrega — inclusive das reentregas da
 * mesma mensagem. Usar `data.email_id` como chave de idempotência faria a
 * segunda notificação sobre o mesmo e-mail (entregue, depois aberto) ser
 * descartada como repetida.
 */
export function toDeliveryEvent(
  body: unknown,
  svixId: string,
): DeliveryEvent | null {
  const payload = body as ResendPayload;
  const type = payload?.type ? TYPE_MAP[payload.type] : undefined;

  if (!type) {
    return null;
  }

  const to = payload.data?.to;
  const email = Array.isArray(to) ? to[0] : to;

  const timestamp = payload.created_at
    ? new Date(payload.created_at)
    : new Date();

  return {
    providerEventId: svixId,
    type,
    messageId: payload.data?.email_id,
    email: email ?? undefined,
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    data: {
      ...(payload.data?.bounce
        ? { bounceType: payload.data.bounce.type, bounce: payload.data.bounce }
        : {}),
      ...(payload.data?.click ? { click: payload.data.click } : {}),
    },
  };
}

/** Tolerância do horário do webhook, em minutos. */
const TIMESTAMP_TOLERANCE_MINUTES = 5;

/**
 * Confere a assinatura Svix, que é a que o Resend usa.
 *
 * **Sem isto, qualquer um na internet forja um `email.bounced`.** E um bounce
 * permanente **desinscreve o assinante**: um POST anônimo bastaria para
 * esvaziar a lista da newsletter, endereço por endereço. É a mesma razão pela
 * qual o webhook do Stripe confere assinatura antes de olhar o corpo.
 *
 * O esquema: HMAC-SHA256 sobre `id.timestamp.corpo`, com o segredo em base64
 * depois do prefixo `whsec_`. O cabeçalho traz uma lista de assinaturas
 * separadas por espaço (`v1,<base64>`), porque durante a rotação da chave o
 * provedor manda a antiga e a nova — basta uma bater.
 *
 * A comparação é em tempo constante e o horário é conferido: sem a janela, uma
 * requisição capturada valeria para sempre.
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  rawBody: Buffer;
  now?: Date;
}): boolean {
  const seconds = Number(input.timestamp);

  if (!Number.isFinite(seconds)) {
    return false;
  }

  const now = input.now ?? new Date();
  const driftMinutes = Math.abs(now.getTime() / 1000 - seconds) / 60;

  if (driftMinutes > TIMESTAMP_TOLERANCE_MINUTES) {
    return false;
  }

  const key = Buffer.from(input.secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${input.id}.${input.timestamp}.${input.rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', key).update(signed).digest();

  return input.signatureHeader
    .split(' ')
    .filter((part) => part.startsWith('v1,'))
    .some((part) => equals(expected, part.slice(3)));
}

function equals(expected: Buffer, candidate: string): boolean {
  const received = Buffer.from(candidate, 'base64');

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
