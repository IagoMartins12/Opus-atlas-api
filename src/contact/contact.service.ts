import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { NewsletterService } from '../newsletter/newsletter.service';
import { ContactResponseDto } from './dto/contact-response.dto';
import { SubmitContactDto } from './dto/submit-contact.dto';

/**
 * Porta `POST /api/contact` do legado. Uma diferença deliberada: quando
 * `subscribeNewsletter` é marcado, o legado fazia um `fetch()` HTTP para a
 * própria API (`/api/newsletter/subscribe`) de dentro do handler — um
 * auto-request desnecessário. Aqui a inscrição é uma chamada de método
 * direta ao `NewsletterService` (mesma injeção de dependência do Nest),
 * sem round-trip de rede.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly newsletterService: NewsletterService,
  ) {}

  async submit(
    dto: SubmitContactDto,
    context: { ipAddress: string; userAgent: string },
  ): Promise<ContactResponseDto> {
    const ticketId = this.generateTicketId();

    if (dto.subscribeNewsletter) {
      try {
        await this.newsletterService.subscribe({
          email: dto.email,
          firstName: dto.name.split(' ')[0],
          lastName: dto.name.split(' ').slice(1).join(' '),
          sourceUrl: 'contact_form',
          utmSource: 'contact',
        });
      } catch (error) {
        this.logger.warn(
          `Falha ao inscrever ${dto.email} na newsletter via contato: ${(error as Error).message}`,
        );
      }
    }

    await this.mailService.sendContactSupportNotification({
      ticketId,
      name: dto.name,
      email: dto.email,
      subject: dto.subject,
      message: dto.message,
      category: dto.category,
      priority: dto.priority,
    });

    await this.mailService.sendContactConfirmationEmail(dto.email, {
      firstName: dto.name.split(' ')[0],
      ticketId,
    });

    this.logger.log(
      `Contato recebido [${ticketId}] categoria=${dto.category} prioridade=${dto.priority} ip=${context.ipAddress}`,
    );

    return {
      success: true,
      message: 'Mensagem enviada com sucesso! Responderemos em breve.',
      ticketId,
    };
  }

  private generateTicketId(): string {
    const prefix = 'CH';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }
}
