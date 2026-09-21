import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenType } from '@prisma/client';
import { UserTokenService } from '../auth/user-token.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { NewsletterActionResponseDto } from './dto/newsletter-action-response.dto';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { UnsubscribeNewsletterDto } from './dto/unsubscribe-newsletter.dto';

const CONFIRMATION_RATE_LIMIT_PER_HOUR = 3;

/**
 * Porta `newsletter/{subscribe,confirm,unsubscribe,resubscribe}` do legado.
 *
 * Correção de um bug real do fluxo original: o link de confirmação enviado
 * por e-mail sempre apontava para `/newsletter/confirm/{token}` (path param —
 * ver `createTokenUrl` em `tokenUtils.ts`), mas essa rota buscava o assinante
 * pelo campo `NewsletterSubscriber.confirmationToken`, que o próprio
 * `subscribe` **nunca preenchia**. Só a rota alternativa por query string
 * (`?token=`, nunca linkada em nenhum e-mail) buscava corretamente via
 * `UserToken.anonymousEmail`. Ou seja, o double opt-in de visitante anônimo
 * estava quebrado em produção. Esta implementação usa só o caminho que
 * realmente funciona (`UserToken` + `anonymousEmail`/`userId`).
 */
@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userTokenService: UserTokenService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async subscribe(
    dto: SubscribeNewsletterDto,
  ): Promise<NewsletterActionResponseDto> {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.newsletterSubscriber.findUnique({
      where: { email },
    });

    if (existing) {
      switch (existing.status) {
        case 'ACTIVE':
          return {
            success: false,
            status: 'ACTIVE',
            message: 'Este e-mail já está inscrito na nossa newsletter.',
          };
        case 'PENDING':
          return {
            success: false,
            status: 'PENDING',
            message:
              'Este e-mail já foi cadastrado mas ainda não foi confirmado. Verifique sua caixa de entrada.',
          };
        case 'BOUNCED':
          return {
            success: false,
            status: 'BOUNCED',
            message:
              'Este e-mail teve problemas de entrega anteriormente. Verifique se o endereço está correto.',
          };
        case 'BLOCKED':
          return {
            success: false,
            status: 'BLOCKED',
            message: 'Este e-mail foi bloqueado. Entre em contato conosco.',
          };
        case 'UNSUBSCRIBED':
          return this.reactivate(existing.id, email, dto.firstName);
      }
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, lastName: true },
    });

    await this.prisma.newsletterSubscriber.create({
      data: {
        email,
        firstName: dto.firstName?.trim() || existingUser?.firstName || null,
        lastName: dto.lastName?.trim() || existingUser?.lastName || null,
        userId: existingUser?.id ?? null,
        status: 'PENDING',
        preferences: dto.interests?.length
          ? { interests: dto.interests }
          : null,
        frequency: dto.frequency ?? 'weekly',
        sourceUrl: dto.sourceUrl,
        referralSource: dto.utmSource,
      },
    });

    await this.sendConfirmationEmail({
      email,
      userId: existingUser?.id,
      firstName: dto.firstName || existingUser?.firstName || 'Usuário',
    });

    this.logger.log(`Newsletter: nova inscrição pendente para ${email}`);

    return {
      success: true,
      status: 'PENDING',
      message: 'Inscrição realizada! Verifique seu e-mail para confirmar.',
    };
  }

  async resendConfirmation(
    email: string,
  ): Promise<NewsletterActionResponseDto> {
    const normalizedEmail = email.toLowerCase().trim();
    const subscriber = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
    });

    if (!subscriber) {
      throw new NotFoundException('E-mail não encontrado');
    }

    if (subscriber.status !== 'PENDING') {
      return {
        success: false,
        status: subscriber.status,
        message: 'Este e-mail não está aguardando confirmação.',
      };
    }

    const rateLimit = await this.userTokenService.checkRateLimit(
      subscriber.userId
        ? { userId: subscriber.userId }
        : { anonymousEmail: normalizedEmail },
      TokenType.NEWSLETTER_CONFIRMATION,
      CONFIRMATION_RATE_LIMIT_PER_HOUR,
    );

    if (!rateLimit.allowed) {
      return {
        success: false,
        message: 'Muitas tentativas. Tente novamente em 1 hora.',
        remainingAttempts: rateLimit.remainingAttempts,
      };
    }

    await this.sendConfirmationEmail({
      email: normalizedEmail,
      userId: subscriber.userId ?? undefined,
      firstName: subscriber.firstName || 'Usuário',
    });

    return {
      success: true,
      message: 'Email de confirmação reenviado com sucesso!',
      remainingAttempts: rateLimit.remainingAttempts - 1,
    };
  }

  async confirm(token: string): Promise<NewsletterActionResponseDto> {
    const validation = await this.userTokenService.validateToken(
      token,
      TokenType.NEWSLETTER_CONFIRMATION,
    );

    if (!validation.valid) {
      const message = validation.expired
        ? 'Token expirado. Inscreva-se novamente na newsletter.'
        : validation.used
          ? 'Este link de confirmação já foi utilizado.'
          : 'Token inválido.';
      return { success: false, message };
    }

    const subscriber = await this.findSubscriberByToken(validation.token!);
    if (!subscriber) {
      throw new NotFoundException('Inscrição não encontrada');
    }

    await this.userTokenService.markTokenAsUsed(token);

    if (subscriber.status === 'ACTIVE') {
      return {
        success: true,
        status: 'ACTIVE',
        message: 'Esta inscrição já foi confirmada anteriormente.',
      };
    }

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: 'ACTIVE', confirmedAt: new Date() },
    });

    await this.prisma.newsletterEmailEvent.create({
      data: {
        eventType: 'DELIVERED',
        subscriberId: subscriber.id,
        eventData: { action: 'email_confirmed' },
      },
    });

    const unsubscribeToken = await this.userTokenService.createToken({
      userId: subscriber.userId ?? undefined,
      anonymousEmail: subscriber.userId ? undefined : subscriber.email,
      type: TokenType.NEWSLETTER_UNSUBSCRIBE,
    });

    await this.mailService.sendNewsletterWelcomeEmail(subscriber.email, {
      firstName: subscriber.firstName || 'Usuário',
      unsubscribeUrl: this.buildUrl('newsletter/unsubscribe', unsubscribeToken),
    });

    return {
      success: true,
      status: 'ACTIVE',
      message: 'Inscrição na newsletter confirmada com sucesso!',
    };
  }

  async unsubscribe(
    dto: UnsubscribeNewsletterDto,
  ): Promise<NewsletterActionResponseDto> {
    let subscriber;

    if (dto.token) {
      const validation = await this.userTokenService.validateToken(
        dto.token,
        TokenType.NEWSLETTER_UNSUBSCRIBE,
      );

      if (!validation.valid) {
        const message = validation.expired
          ? 'Token expirado.'
          : validation.used
            ? 'Token já foi utilizado.'
            : 'Token inválido.';
        return { success: false, message };
      }

      subscriber = await this.findSubscriberByToken(validation.token!);
      await this.userTokenService.markTokenAsUsed(dto.token);
    } else if (dto.email) {
      subscriber = await this.prisma.newsletterSubscriber.findUnique({
        where: { email: dto.email.toLowerCase().trim() },
      });
    }

    if (!subscriber) {
      throw new NotFoundException('Inscrição não encontrada');
    }

    if (subscriber.status === 'UNSUBSCRIBED') {
      return {
        success: false,
        status: 'UNSUBSCRIBED',
        message: 'Esta inscrição já foi cancelada anteriormente.',
      };
    }

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date(),
        unsubscribeReason: dto.reason ?? 'not_specified',
      },
    });

    await this.prisma.newsletterEmailEvent.create({
      data: {
        eventType: 'UNSUBSCRIBED',
        subscriberId: subscriber.id,
        eventData: { reason: dto.reason, feedback: dto.feedback },
      },
    });

    await this.mailService.sendNewsletterUnsubscribeConfirmationEmail(
      subscriber.email,
      {
        firstName: subscriber.firstName || 'Usuário',
        resubscribeUrl: `${this.getFrontendBaseUrl()}/newsletter/resubscribe?email=${encodeURIComponent(subscriber.email)}`,
      },
    );

    return {
      success: true,
      status: 'UNSUBSCRIBED',
      message: 'Inscrição cancelada com sucesso.',
    };
  }

  async resubscribe(email: string): Promise<NewsletterActionResponseDto> {
    const normalizedEmail = email.toLowerCase().trim();
    const subscriber = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
    });

    if (!subscriber) {
      throw new NotFoundException('E-mail não encontrado');
    }

    if (subscriber.status === 'ACTIVE') {
      return {
        success: false,
        status: 'ACTIVE',
        message: 'Este e-mail já está ativo na newsletter.',
      };
    }

    if (subscriber.status === 'PENDING') {
      return {
        success: false,
        status: 'PENDING',
        message: 'Este e-mail já está pendente de confirmação.',
      };
    }

    return this.reactivate(
      subscriber.id,
      normalizedEmail,
      subscriber.firstName ?? undefined,
    );
  }

  /** Reativa um subscriber `UNSUBSCRIBED`/`BOUNCED` — usado tanto por
   * `subscribe` (quando o e-mail já existia como `UNSUBSCRIBED`) quanto por
   * `resubscribe`, evitando duplicar a lógica como o legado fazia. */
  private async reactivate(
    subscriberId: string,
    email: string,
    firstName?: string,
  ): Promise<NewsletterActionResponseDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true, lastName: true },
    });

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriberId },
      data: {
        status: 'PENDING',
        subscribedAt: new Date(),
        confirmedAt: null,
        unsubscribedAt: null,
        unsubscribeReason: null,
        firstName: existingUser?.firstName || firstName,
        lastName: existingUser?.lastName,
        userId: existingUser?.id,
      },
    });

    await this.sendConfirmationEmail({
      email,
      userId: existingUser?.id,
      firstName: existingUser?.firstName || firstName || 'Usuário',
    });

    this.logger.log(`Newsletter: reinscrição pendente para ${email}`);

    return {
      success: true,
      status: 'RESUBSCRIBED',
      message: 'Bem-vindo de volta! Enviamos um e-mail de confirmação.',
    };
  }

  private async sendConfirmationEmail(data: {
    email: string;
    userId?: string;
    firstName: string;
  }): Promise<void> {
    const confirmationToken = await this.userTokenService.createToken({
      userId: data.userId,
      anonymousEmail: data.userId ? undefined : data.email,
      type: TokenType.NEWSLETTER_CONFIRMATION,
    });

    const unsubscribeToken = await this.userTokenService.createToken({
      userId: data.userId,
      anonymousEmail: data.userId ? undefined : data.email,
      type: TokenType.NEWSLETTER_UNSUBSCRIBE,
    });

    await this.mailService.sendNewsletterConfirmationEmail(data.email, {
      firstName: data.firstName,
      confirmationUrl: this.buildUrl('newsletter/confirm', confirmationToken),
      unsubscribeUrl: this.buildUrl('newsletter/unsubscribe', unsubscribeToken),
    });
  }

  private async findSubscriberByToken(tokenRecord: {
    userId: string | null;
    anonymousEmail: string | null;
  }) {
    if (tokenRecord.userId) {
      return this.prisma.newsletterSubscriber.findFirst({
        where: { userId: tokenRecord.userId },
      });
    }

    if (tokenRecord.anonymousEmail) {
      return this.prisma.newsletterSubscriber.findUnique({
        where: { email: tokenRecord.anonymousEmail },
      });
    }

    return null;
  }

  private buildUrl(path: string, token: string): string {
    return `${this.getFrontendBaseUrl()}/${path}/${token}`;
  }

  private getFrontendBaseUrl(): string {
    return this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }
}
