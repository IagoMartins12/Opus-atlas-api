import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService, normalizeMessageId } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const config = (values: Record<string, unknown>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

const smtp = {
  'mail.user': 'u',
  'mail.pass': 'p',
  'mail.host': 'smtp',
  'mail.port': 587,
  'mail.secure': false,
  'mail.from': 'Opus Atlas <noreply@opusatlas.com>',
  'mail.replyTo': 'contato@opusatlas.com',
  'mail.supportTo': 'suporte@opusatlas.com',
};

describe('MailService — envio', () => {
  let sendMail: jest.Mock;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({ messageId: '<abc@opus>' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  it('sem SMTP, só registra e conta como entregue (desenvolvimento)', async () => {
    const service = new MailService(config({}));

    await expect(
      service.trySend({ to: 'a@x.com', subject: 's', html: '<p>oi</p>' }),
    ).resolves.toEqual({
      delivered: true,
    });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('com SMTP, devolve o Message-ID sem os sinais, e reaproveita o transporte', async () => {
    const service = new MailService(config(smtp));

    await expect(
      service.trySend({
        to: 'a@x.com',
        subject: 's',
        html: '<p>Olá  <b>Ana</b></p>',
      }),
    ).resolves.toEqual({
      delivered: true,
      messageId: 'abc@opus',
    });
    await service.trySend({
      to: 'b@x.com',
      subject: 's',
      html: 'x',
      text: 'texto',
      headers: { 'List-Unsubscribe': '<x>' },
    });

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    // Sem limite, SMTP bloqueado pendura o cadastro até o 408 (ver SMTP_TIMEOUTS).
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    );
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      text: 'Olá Ana',
      replyTo: 'contato@opusatlas.com',
    });
    expect(sendMail.mock.calls[1][0]).toMatchObject({
      text: 'texto',
      headers: { 'List-Unsubscribe': '<x>' },
    });
  });

  // Nome livre, endereço autorizado: o domínio de envio não muda.
  it('troca só o nome do remetente, limpando caracteres de cabeçalho', async () => {
    const service = new MailService(config(smtp));

    await service.trySend({
      to: 'a',
      subject: 's',
      html: 'x',
      fromName: 'Maria <"x">\r\n',
      replyTo: 'r@x.com',
    });
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: 'Maria x <noreply@opusatlas.com>',
      replyTo: 'r@x.com',
    });

    const semSinais = new MailService(
      config({ ...smtp, 'mail.from': 'noreply@opusatlas.com' }),
    );
    await semSinais.trySend({
      to: 'a',
      subject: 's',
      html: 'x',
      fromName: 'Ana',
    });
    expect(sendMail.mock.calls[1][0].from).toBe('Ana <noreply@opusatlas.com>');
  });

  it('falha do servidor volta como não entregue; send() só registra', async () => {
    sendMail.mockRejectedValue(new Error('550 recusado'));
    const service = new MailService(config(smtp));

    await expect(
      service.trySend({ to: 'a', subject: 's', html: 'x' }),
    ).resolves.toEqual({
      delivered: false,
      error: '550 recusado',
    });
    await expect(
      service.send({ to: 'a', subject: 's', html: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('Message-ID vazio vira undefined', () => {
    expect(normalizeMessageId(undefined)).toBeUndefined();
    expect(normalizeMessageId('<>')).toBeUndefined();
    expect(normalizeMessageId('id@x')).toBe('id@x');
  });
});

describe('MailService — modelos', () => {
  let service: MailService;
  let send: jest.SpyInstance;

  beforeEach(() => {
    service = new MailService(config(smtp));
    send = jest.spyOn(service, 'send').mockResolvedValue(undefined);
  });

  const lastHtml = () => (send.mock.calls.at(-1)[0] as { html: string }).html;
  const lastSubject = () =>
    (send.mock.calls.at(-1)[0] as { subject: string }).subject;

  // O nome é texto do usuário: nunca pode virar HTML no e-mail.
  it.each([
    [
      'sendAccountConfirmationEmail',
      { confirmationUrl: 'https://x/c' },
      'Confirme sua conta',
    ],
    ['sendPasswordResetEmail', { resetUrl: 'https://x/r' }, 'Redefinir senha'],
    ['sendGoogleAccountResetNotice', {}, 'login do Google'],
    ['sendPasswordChangedEmail', { ipAddress: '1.1.1.1' }, 'Senha alterada'],
    [
      'sendEmailChangeRequestEmail',
      { confirmationUrl: 'https://x/e' },
      'novo e-mail',
    ],
    [
      'sendEmailChangedToOldAddress',
      { newEmail: 'novo@x.com' },
      'foi alterado',
    ],
    ['sendEmailChangeConfirmedToNewAddress', {}, 'confirmado'],
    ['sendAccountDeletedFarewellEmail', {}, 'Até logo'],
    ['sendContactConfirmationEmail', { ticketId: 'CH-1' }, 'CH-1'],
    [
      'sendNewsletterConfirmationEmail',
      { confirmationUrl: 'https://x/c', unsubscribeUrl: 'https://x/u' },
      'Confirme sua inscrição',
    ],
    [
      'sendNewsletterWelcomeEmail',
      { unsubscribeUrl: 'https://x/u' },
      'Inscrição confirmada',
    ],
    [
      'sendNewsletterUnsubscribeConfirmationEmail',
      { resubscribeUrl: 'https://x/r' },
      'Inscrição cancelada',
    ],
    [
      'sendTeacherInvitationEmail',
      {
        invitedByName: '<i>Admin</i>',
        acceptUrl: 'https://x/a',
        declineUrl: 'https://x/d',
      },
      'Convite',
    ],
    [
      'sendSubscriptionCancelledEmail',
      { planType: 'PLUS' },
      'Assinatura cancelada',
    ],
    [
      'sendTrialExpiringEmail',
      { planType: 'MENTOR', daysRemaining: 2 },
      'teste',
    ],
  ])(
    '%s escapa o nome e tem o assunto certo',
    async (method, data, subjectPart) => {
      await (
        service as unknown as Record<
          string,
          (to: string, d: object) => Promise<void>
        >
      )[method]('a@x.com', { firstName: '<script>x</script>', ...data });

      expect(lastHtml()).not.toContain('<script>x</script>');
      expect(lastHtml()).toContain('&lt;script&gt;');
      expect(`${lastSubject()} ${lastHtml()}`).toContain(subjectPart);
    },
  );

  it('pagamento aprovado mostra o valor em reais e o período', async () => {
    await service.sendPaymentApprovedEmail('a@x.com', {
      firstName: 'Ana',
      planType: 'MAESTRO',
      billingPeriod: 'YEARLY',
      amount: 1234.5,
    });
    expect(lastHtml()).toMatch(/R\$\s?1\.234,50/);
    expect(lastHtml()).toContain('(Anual)');

    await service.sendPaymentApprovedEmail('a@x.com', {
      firstName: 'Ana',
      planType: 'PLUS',
      amount: 10,
    });
    expect(lastHtml()).not.toContain('(Mensal)');
  });

  it('troca de plano: upgrade confirmado ou downgrade agendado', async () => {
    await service.sendPlanChangedEmail('a', {
      firstName: 'Ana',
      fromPlan: 'PLUS',
      toPlan: 'MAESTRO',
      changeType: 'UPGRADE',
    });
    expect(lastSubject()).toContain('Upgrade confirmado');

    await service.sendPlanChangedEmail('a', {
      firstName: 'Ana',
      fromPlan: 'MAESTRO',
      toPlan: 'PLUS',
      changeType: 'DOWNGRADE',
    });
    expect(lastSubject()).toContain('Downgrade agendado');
  });

  it('lembrete de renovação traz data e valor', async () => {
    await service.sendRenewalReminderEmail('a', {
      firstName: 'Ana',
      planType: 'PLUS',
      renewalDate: new Date('2026-10-01T12:00:00Z'),
      amount: 29.9,
    });

    expect(lastHtml()).toContain('01/10/2026');
    expect(lastHtml()).toMatch(/R\$\s?29,90/);
  });

  // Mensagem de contato vem de visitante sem login: tudo escapado.
  it('aviso ao suporte vai para o endereço do suporte, com o conteúdo escapado', async () => {
    await service.sendContactSupportNotification({
      ticketId: 'CH-1',
      name: '<b>Ana</b>',
      email: 'a@x.com',
      subject: 'Ajuda',
      message: '<a href="x">clique</a>',
      category: 'geral',
      priority: 'alta',
    });

    const input = send.mock.calls.at(-1)[0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(input.to).toBe('suporte@opusatlas.com');
    expect(input.subject).toBe('[CH-1] Ajuda');
    expect(input.html).not.toContain('<a href="x">');
  });
});

describe('MailService — boas-vindas do Google', () => {
  it('nome escapado e link para completar o perfil', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<w@opus>' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new MailService(config(smtp));

    await service.sendWelcomeEmail('ana@x.com', {
      firstName: '<b>Ana</b>',
      onboardingUrl: 'http://front/?onboarding=true',
    });

    const [message] = sendMail.mock.calls[0];
    expect(message.to).toBe('ana@x.com');
    expect(message.subject).toContain('Bem-vindo');
    expect(message.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(message.html).toContain('http://front/?onboarding=true');
  });
});
