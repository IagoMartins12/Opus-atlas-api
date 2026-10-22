import type { Request } from 'express';
import { MailService } from '../mail/mail.service';
import { NewsletterService } from '../newsletter/newsletter.service';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

const dto = {
  name: 'Ana Maria Lima',
  email: 'ana@x.com',
  subject: 'Dúvida',
  message: 'Olá',
  category: 'general',
  priority: 'normal',
} as never;

describe('ContactService', () => {
  let mail: {
    sendContactSupportNotification: jest.Mock;
    sendContactConfirmationEmail: jest.Mock;
  };
  let newsletter: { subscribe: jest.Mock };
  let prisma: {
    user: { findFirst: jest.Mock };
    supportTicket: { create: jest.Mock };
  };
  let subscriptions: { effectivePlan: jest.Mock };
  let service: ContactService;

  beforeEach(() => {
    mail = {
      sendContactSupportNotification: jest.fn().mockResolvedValue(undefined),
      sendContactConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    };
    newsletter = { subscribe: jest.fn().mockResolvedValue({ success: true }) };
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      supportTicket: { create: jest.fn().mockResolvedValue({}) },
    };
    subscriptions = {
      effectivePlan: jest.fn().mockResolvedValue({ plan: 'FREE' }),
    };
    service = new ContactService(
      mail as unknown as MailService,
      newsletter as unknown as NewsletterService,
      prisma as never,
      subscriptions as never,
    );
  });

  it('avisa o suporte, confirma para a pessoa e devolve o protocolo', async () => {
    const result = await service.submit(dto, {
      ipAddress: '1.1.1.1',
      userAgent: 'x',
      language: 'pt',
    });

    expect(result.ticketId).toMatch(/^CH-[0-9A-Z]+-[0-9A-Z]{1,4}$/);
    expect(mail.sendContactSupportNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: result.ticketId,
        email: 'ana@x.com',
      }),
    );
    expect(mail.sendContactConfirmationEmail).toHaveBeenCalledWith(
      'ana@x.com',
      {
        firstName: 'Ana',
        ticketId: result.ticketId,
      },
      'pt',
    );
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });

  // Quem escreve pelo site em inglês pode nem ter conta: a confirmação segue o
  // idioma do pedido, não o do cadastro.
  it('a confirmação sai no idioma de quem escreveu, e a inscrição opcional também', async () => {
    await service.submit(
      { ...(dto as object), subscribeNewsletter: true } as never,
      { ipAddress: '1', userAgent: 'x', language: 'en' },
    );

    expect(mail.sendContactConfirmationEmail).toHaveBeenCalledWith(
      'ana@x.com',
      expect.any(Object),
      'en',
    );
    expect(newsletter.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en' }),
    );
  });

  it('inscreve na newsletter por chamada direta, com nome e sobrenome', async () => {
    await service.submit(
      { ...(dto as object), subscribeNewsletter: true } as never,
      {
        ipAddress: '1',
        userAgent: 'x',
        language: 'pt',
      },
    );

    expect(newsletter.subscribe).toHaveBeenCalledWith({
      email: 'ana@x.com',
      firstName: 'Ana',
      lastName: 'Maria Lima',
      sourceUrl: 'contact_form',
      utmSource: 'contact',
      language: 'pt',
    });
  });

  // A inscrição é bônus; não pode impedir a mensagem de chegar ao suporte.
  it('falha na inscrição não impede o contato', async () => {
    newsletter.subscribe.mockRejectedValue(new Error('smtp'));

    await expect(
      service.submit(
        { ...(dto as object), subscribeNewsletter: true } as never,
        {
          ipAddress: '1',
          userAgent: 'x',
          language: 'pt',
        },
      ),
    ).resolves.toMatchObject({ success: true });
    expect(mail.sendContactSupportNotification).toHaveBeenCalled();
  });
  describe('suporte prioritário', () => {
    it('guarda o chamado no painel; sem conta, é Free e sem prioridade', async () => {
      await service.submit(dto, {
        ipAddress: '1',
        userAgent: 'x',
        language: 'pt',
      });

      expect(prisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          plan: 'FREE',
          prioritySupport: false,
          userId: null,
        }),
      });
      expect(mail.sendContactSupportNotification).toHaveBeenCalledWith(
        expect.objectContaining({ prioritySupport: false }),
      );
    });

    it('quem tem Plus (pela sessão) entra como prioritário', async () => {
      subscriptions.effectivePlan.mockResolvedValue({ plan: 'PLUS' });

      await service.submit(dto, {
        ipAddress: '1',
        userAgent: 'x',
        language: 'pt',
        userId: 'u1',
      });

      expect(subscriptions.effectivePlan).toHaveBeenCalledWith('u1');
      expect(prisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ prioritySupport: true, plan: 'PLUS' }),
      });
      expect(mail.sendContactSupportNotification).toHaveBeenCalledWith(
        expect.objectContaining({ prioritySupport: true }),
      );
    });

    it('sem sessão, o e-mail do formulário encontra a conta', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2' });
      subscriptions.effectivePlan.mockResolvedValue({ plan: 'MAESTRO' });

      await service.submit(dto, {
        ipAddress: '1',
        userAgent: 'x',
        language: 'pt',
      });

      expect(subscriptions.effectivePlan).toHaveBeenCalledWith('u2');
      expect(prisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ prioritySupport: true, userId: 'u2' }),
      });
    });

    it('falha ao guardar o chamado não impede o e-mail', async () => {
      prisma.supportTicket.create.mockRejectedValue(new Error('banco fora'));

      const r = await service.submit(dto, {
        ipAddress: '1',
        userAgent: 'x',
        language: 'pt',
      });

      expect(r.success).toBe(true);
      expect(mail.sendContactSupportNotification).toHaveBeenCalled();
    });
  });
});

describe('ContactController', () => {
  const submit = jest.fn().mockResolvedValue({ success: true });
  const controller = new ContactController({
    submit,
  } as unknown as ContactService);
  const req = (headers: Record<string, string>, ip?: string) =>
    ({ headers, ip }) as unknown as Request;

  beforeEach(() => submit.mockClear());

  it('usa o primeiro IP do x-forwarded-for', async () => {
    await controller.submit(
      dto,
      req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'user-agent': 'UA' }),
    );

    expect(submit).toHaveBeenCalledWith(dto, {
      ipAddress: '9.9.9.9',
      userAgent: 'UA',
      language: 'pt',
    });
  });

  it('sem cabeçalho usa req.ip; sem nada, "unknown"', async () => {
    await controller.submit(dto, req({}, '2.2.2.2'));
    expect(submit).toHaveBeenLastCalledWith(dto, {
      ipAddress: '2.2.2.2',
      userAgent: 'unknown',
      language: 'pt',
    });

    await controller.submit(dto, req({}));
    expect(submit).toHaveBeenLastCalledWith(dto, {
      ipAddress: 'unknown',
      userAgent: 'unknown',
      language: 'pt',
    });
  });

  // O formulário manda o idioma do site; sem ele, vale o do navegador.
  it('o idioma do pedido vem do corpo, e na falta dele do Accept-Language', async () => {
    await controller.submit(
      { ...(dto as object), language: 'en' } as never,
      req({ 'accept-language': 'pt-BR,pt;q=0.9' }),
    );
    expect(submit.mock.calls[0][1].language).toBe('en');

    await controller.submit(
      dto,
      req({ 'accept-language': 'en-US,en;q=0.9,pt;q=0.8' }),
    );
    expect(submit.mock.calls[1][1].language).toBe('en');

    await controller.submit(dto, req({ 'accept-language': 'fr-FR,fr;q=0.9' }));
    expect(submit.mock.calls[2][1].language).toBe('pt');
  });
});
