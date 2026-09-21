import { createHmac } from 'node:crypto';
import { EmailEventType } from '@prisma/client';
import { toDeliveryEvent, verifySvixSignature } from './resend.adapter';

describe('toDeliveryEvent (Resend)', () => {
  const payload = (type: string, data: Record<string, unknown> = {}) => ({
    type,
    created_at: '2026-09-10T12:00:00.000Z',
    data: { email_id: 'msg-1', to: ['pessoa@exemplo.com'], ...data },
  });

  it('traduz uma entrega', () => {
    const event = toDeliveryEvent(payload('email.delivered'), 'svix-1');

    expect(event).toMatchObject({
      providerEventId: 'svix-1',
      type: EmailEventType.DELIVERED,
      messageId: 'msg-1',
      email: 'pessoa@exemplo.com',
    });
  });

  // Usar `email_id` como chave de idempotência faria a segunda notificação
  // sobre a mesma mensagem (entregue, depois aberta) ser descartada.
  it('a chave de idempotência vem do cabeçalho, não do corpo', () => {
    const entregue = toDeliveryEvent(payload('email.delivered'), 'svix-1');
    const aberta = toDeliveryEvent(payload('email.opened'), 'svix-2');

    expect(entregue?.providerEventId).not.toBe(aberta?.providerEventId);
    expect(entregue?.messageId).toBe(aberta?.messageId);
  });

  it('carrega o tipo do retorno, que decide se desinscreve', () => {
    const event = toDeliveryEvent(
      payload('email.bounced', { bounce: { type: 'Permanent' } }),
      'svix-1',
    );

    expect(event?.data?.bounceType).toBe('Permanent');
  });

  // Atraso não é entrega nem retorno; contá-lo em qualquer um mentiria.
  it('ignora o evento de atraso', () => {
    expect(
      toDeliveryEvent(payload('email.delivery_delayed'), 'svix-1'),
    ).toBeNull();
  });

  it('ignora tipo desconhecido', () => {
    expect(
      toDeliveryEvent(payload('email.qualquer_coisa'), 'svix-1'),
    ).toBeNull();
  });

  it('sobrevive a corpo sem os campos esperados', () => {
    expect(toDeliveryEvent({}, 'svix-1')).toBeNull();
    expect(
      toDeliveryEvent({ type: 'email.delivered' }, 'svix-1'),
    ).toMatchObject({ type: EmailEventType.DELIVERED });
  });

  it('data ilegível cai para agora, em vez de virar data inválida', () => {
    const event = toDeliveryEvent(
      { type: 'email.delivered', created_at: 'ontem' },
      'svix-1',
    );

    expect(Number.isNaN(event!.timestamp.getTime())).toBe(false);
  });
});

describe('verifySvixSignature', () => {
  const secret = 'whsec_' + Buffer.from('segredo-de-teste').toString('base64');
  const rawBody = Buffer.from('{"type":"email.bounced"}');
  const now = new Date('2026-09-10T12:00:00Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));

  const assinar = (id: string, ts: string, body: Buffer, key = secret) =>
    createHmac('sha256', Buffer.from(key.replace(/^whsec_/, ''), 'base64'))
      .update(`${id}.${ts}.${body.toString('utf8')}`)
      .digest('base64');

  const base = {
    secret,
    id: 'svix-1',
    timestamp,
    rawBody,
    now,
  };

  it('aceita a assinatura correta', () => {
    expect(
      verifySvixSignature({
        ...base,
        signatureHeader: `v1,${assinar('svix-1', timestamp, rawBody)}`,
      }),
    ).toBe(true);
  });

  // Durante a rotação da chave o provedor manda a antiga e a nova.
  it('basta uma das assinaturas da lista bater', () => {
    expect(
      verifySvixSignature({
        ...base,
        signatureHeader: `v1,${'x'.repeat(44)} v1,${assinar('svix-1', timestamp, rawBody)}`,
      }),
    ).toBe(true);
  });

  // Sem isto, um POST anônimo forjando `email.bounced` desinscreve assinante
  // por assinante até esvaziar a lista.
  it('recusa assinatura errada', () => {
    expect(
      verifySvixSignature({
        ...base,
        signatureHeader: `v1,${assinar('svix-1', timestamp, rawBody, 'whsec_' + Buffer.from('outro').toString('base64'))}`,
      }),
    ).toBe(false);
  });

  it('recusa quando o corpo foi alterado', () => {
    expect(
      verifySvixSignature({
        ...base,
        rawBody: Buffer.from('{"type":"email.delivered"}'),
        signatureHeader: `v1,${assinar('svix-1', timestamp, rawBody)}`,
      }),
    ).toBe(false);
  });

  it('recusa quando o id do cabeçalho não é o assinado', () => {
    expect(
      verifySvixSignature({
        ...base,
        id: 'svix-2',
        signatureHeader: `v1,${assinar('svix-1', timestamp, rawBody)}`,
      }),
    ).toBe(false);
  });

  // Sem a janela de tempo, uma requisição capturada valeria para sempre.
  it('recusa requisição antiga', () => {
    const velho = String(Math.floor(now.getTime() / 1000) - 3600);

    expect(
      verifySvixSignature({
        ...base,
        timestamp: velho,
        signatureHeader: `v1,${assinar('svix-1', velho, rawBody)}`,
      }),
    ).toBe(false);
  });

  it('recusa horário ilegível', () => {
    expect(
      verifySvixSignature({
        ...base,
        timestamp: 'ontem',
        signatureHeader: 'v1,x',
      }),
    ).toBe(false);
  });

  it('recusa cabeçalho sem versão conhecida', () => {
    expect(
      verifySvixSignature({
        ...base,
        signatureHeader: `v9,${assinar('svix-1', timestamp, rawBody)}`,
      }),
    ).toBe(false);
  });

  it('assinatura de tamanho errado não derruba a verificação', () => {
    expect(verifySvixSignature({ ...base, signatureHeader: 'v1,YWJj' })).toBe(
      false,
    );
  });
});
