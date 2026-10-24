import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsService } from '../billing/services/subscriptions.service';
import { hasFeature } from '../billing/constants/plan-features.constants';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Quem escreveu e se tem suporte prioritário (do Plus em diante, inclusive o
   * Plus dado pelo professor). A sessão vale primeiro; sem ela, o e-mail do
   * formulário encontra a conta.
   */
  private async whoIs(userId: string | undefined, email: string) {
    const user = userId
      ? { id: userId }
      : await this.prisma.user.findFirst({
          where: { email: email.trim().toLowerCase() },
          select: { id: true },
        });
    if (!user) return { userId: null, plan: 'FREE', prioritySupport: false };
    const { plan } = await this.subscriptions.effectivePlan(user.id);
    return {
      userId: user.id,
      plan,
      prioritySupport: hasFeature(plan, 'prioritySupport'),
    };
  }

  async submit(
    dto: SubmitContactDto,
    context: {
      ipAddress: string;
      userAgent: string;
      language: 'pt' | 'en';
      userId?: string;
    },
  ): Promise<ContactResponseDto> {
    const ticketId = this.generateTicketId();
    const who = await this.whoIs(context.userId, dto.email).catch(() => ({
      userId: null,
      plan: 'FREE',
      prioritySupport: false,
    }));

    // Fica no painel (Atendimento), na frente da fila se for prioritário.
    await this.prisma.supportTicket
      .create({
        data: {
          ticketId,
          userId: who.userId,
          name: dto.name,
          email: dto.email,
          subject: dto.subject,
          message: dto.message,
          category: dto.category,
          priority: dto.priority,
          prioritySupport: who.prioritySupport,
          plan: who.plan,
          language: context.language,
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Chamado ${ticketId} não foi guardado: ${(error as Error).message}`,
        ),
      );

    if (dto.subscribeNewsletter) {
      try {
        await this.newsletterService.subscribe({
          email: dto.email,
          firstName: dto.name.split(' ')[0],
          lastName: dto.name.split(' ').slice(1).join(' '),
          sourceUrl: 'contact_form',
          utmSource: 'contact',
          language: context.language,
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
      prioritySupport: who.prioritySupport,
      plan: who.plan,
    });

    await this.mailService.sendContactConfirmationEmail(
      dto.email,
      { firstName: dto.name.split(' ')[0], ticketId },
      context.language,
    );

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
