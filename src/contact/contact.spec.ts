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
  let service: ContactService;

  beforeEach(() => {
    mail = {
      sendContactSupportNotification: jest.fn().mockResolvedValue(undefined),
      sendContactConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    };
    newsletter = { subscribe: jest.fn().mockResolvedValue({ success: true }) };
    service = new ContactService(
      mail as unknown as MailService,
      newsletter as unknown as NewsletterService,
    );
  });

  it('avisa o suporte, confirma para a pessoa e devolve o protocolo', async () => {
    const result = await service.submit(dto, {
      ipAddress: '1.1.1.1',
      userAgent: 'x',
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
    );
    expect(newsletter.subscribe).not.toHaveBeenCalled();
  });

  it('inscreve na newsletter por chamada direta, com nome e sobrenome', async () => {
    await service.submit(
      { ...(dto as object), subscribeNewsletter: true } as never,
      {
        ipAddress: '1',
        userAgent: 'x',
      },
    );

    expect(newsletter.subscribe).toHaveBeenCalledWith({
      email: 'ana@x.com',
      firstName: 'Ana',
      lastName: 'Maria Lima',
      sourceUrl: 'contact_form',
      utmSource: 'contact',
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
        },
      ),
    ).resolves.toMatchObject({ success: true });
    expect(mail.sendContactSupportNotification).toHaveBeenCalled();
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
    });
  });

  it('sem cabeçalho usa req.ip; sem nada, "unknown"', async () => {
    await controller.submit(dto, req({}, '2.2.2.2'));
    expect(submit).toHaveBeenLastCalledWith(dto, {
      ipAddress: '2.2.2.2',
      userAgent: 'unknown',
    });

    await controller.submit(dto, req({}));
    expect(submit).toHaveBeenLastCalledWith(dto, {
      ipAddress: 'unknown',
      userAgent: 'unknown',
    });
  });
});
