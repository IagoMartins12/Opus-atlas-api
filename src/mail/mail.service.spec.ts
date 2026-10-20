import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

const EVIL = '<a href="https://phishing.example">Clique aqui</a>';

describe('MailService — dado do usuário no HTML', () => {
  let service: MailService;
  let send: jest.SpyInstance;

  beforeEach(() => {
    service = new MailService(
      {
        get: () => undefined,
      } as unknown as ConfigService,
      {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        newsletterSubscriber: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService,
    );
    send = jest.spyOn(service, 'send').mockResolvedValue(undefined);
  });

  // Inscrição na newsletter é pública e o endereço é escolhido por quem pede:
  // sem escape, o Opus Atlas enviaria o HTML de um estranho para qualquer um.
  it('o nome da inscrição na newsletter não vira link', async () => {
    await service.sendNewsletterConfirmationEmail('vitima@example.com', {
      firstName: EVIL,
      confirmationUrl: 'https://opusatlas.com.br/c/1',
      unsubscribeUrl: 'https://opusatlas.com.br/u/1',
    });

    const [{ html }] = send.mock.calls[0] as [{ html: string }];
    expect(html).not.toContain('<a href="https://phishing.example">');
    expect(html).toContain(
      '&lt;a href=&quot;https://phishing.example&quot;&gt;',
    );
  });

  // Quem escreve pelo formulário em inglês pode nem ter conta (ou tê-la em
  // português): a confirmação segue o idioma em que a pessoa está vendo o site.
  it('a confirmação do contato sai no idioma pedido, não no do cadastro', async () => {
    const data = { firstName: 'Ana', ticketId: 'CH-1' };

    await service.sendContactConfirmationEmail('ana@x.com', data, 'en');
    await service.sendContactConfirmationEmail('ana@x.com', data, 'pt');
    await service.sendContactConfirmationEmail('ana@x.com', data);

    const [en, pt, semIdioma] = send.mock.calls.map(
      ([mail]) => mail as { subject: string; html: string },
    );
    expect(en.subject).not.toBe(pt.subject);
    expect(en.html).toContain('lang="en-US"');
    expect(pt.html).toContain('lang="pt-BR"');
    // Sem idioma pedido e sem cadastro, segue o padrão: português.
    expect(semIdioma.subject).toBe(pt.subject);
  });

  it('a mensagem do contato chega ao suporte como texto', async () => {
    await service.sendContactSupportNotification({
      ticketId: 'T-1',
      name: EVIL,
      email: 'a@b.c',
      subject: 'oi',
      message: '<img src=x onerror=alert(1)>',
      category: 'geral',
      priority: 'normal',
    } as Parameters<MailService['sendContactSupportNotification']>[0]);

    const [{ html }] = send.mock.calls[0] as [{ html: string }];
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<a href="https://phishing.example">');
  });
});
