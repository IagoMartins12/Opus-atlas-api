import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPeriod, PlanType } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import {
  renderEmail,
  type EmailLanguage,
  type EmailSpec,
} from './email-layout';
import * as templates from './templates';
import type { Say, TemplateContext } from './templates';

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Nome de exibição do remetente.
   *
   * **Só o nome.** O endereço continua sendo o de `EMAIL_FROM`, e isso é
   * deliberado: campanha tem `senderEmail` configurável no painel, mas enviar
   * de um domínio que não passa no SPF/DKIM da conta SMTP é o caminho mais
   * curto para a caixa de spam. Nome livre, endereço autorizado.
   */
  fromName?: string;
  replyTo?: string;
  /** Cabeçalhos extras, ex.: `List-Unsubscribe`. */
  headers?: Record<string, string>;
}

export interface SendMailResult {
  delivered: boolean;
  /**
   * Identificador da mensagem, como o servidor de saída o devolveu.
   *
   * **Ele era descartado.** `sendMail` devolve `messageId` e o retorno inteiro
   * ia para o lixo — o que deixava `NewsletterCampaignSend.emailId` vazio em
   * todo envio. Sem ele, nenhum webhook de provedor nenhum consegue dizer a
   * que campanha e a que assinante um `delivered` ou um `bounce` se refere:
   * o evento chega com o id da mensagem e não encontra par no banco.
   */
  messageId?: string;
  /** Motivo da recusa quando `delivered` é falso. */
  error?: string;
}

/**
 * Envio de e-mails transacionais via SMTP (nodemailer) — mesmo provedor/credenciais
 * já usados pelo front (`Classical-Music/src/app/libs/newsletter/email.ts`), lido
 * das mesmas variáveis de ambiente (`SMTP_*`, `EMAIL_FROM`, `EMAIL_REPLY_TO`).
 *
 * Falha de envio nunca derruba o fluxo de auth que a disparou (registro, reset de
 * senha, etc.) — só é logada. O estado relevante (token criado, senha alterada)
 * já foi persistido antes do e-mail ser disparado.
 */
/**
 * Limites de tempo do SMTP, bem abaixo dos 30 s do `TimeoutInterceptor`.
 *
 * Os padrões do nodemailer são 2 min para conectar e 10 min de silêncio no
 * socket. Com a porta bloqueada — o Render gratuito bloqueia a saída SMTP —
 * a conexão nunca responde nem falha, e o cadastro, que espera o e-mail de
 * confirmação, morria em 408 **depois de já ter criado a conta**. Com estes
 * limites, SMTP inacessível vira o que `send()` já sabe tratar: falha no log,
 * fluxo segue.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getTransporter(): nodemailer.Transporter | null {
    const user = this.configService.get<string>('mail.user');
    const pass = this.configService.get<string>('mail.pass');

    if (!user || !pass) {
      this.logger.warn(
        'SMTP_USER/SMTP_PASS não configurados — e-mails serão apenas logados, não enviados de verdade.',
      );
      return null;
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('mail.host'),
        port: this.configService.get<number>('mail.port'),
        secure: this.configService.get<boolean>('mail.secure'),
        auth: { user, pass },
        ...SMTP_TIMEOUTS,
      });
    }

    return this.transporter;
  }

  /**
   * Envia e **devolve o resultado**.
   *
   * `send()` engole a falha de propósito: nenhum fluxo de autenticação pode
   * quebrar porque o SMTP piscou. Mas quem dispara uma campanha precisa saber
   * quem recebeu e quem não recebeu — sem isso não há como retomar um envio
   * interrompido no meio, nem como dizer ao administrador o que aconteceu.
   */
  async trySend(input: SendMailInput): Promise<SendMailResult> {
    const { to, subject, html, text, fromName, replyTo, headers } = input;
    const transporter = this.getTransporter();

    const body =
      text ??
      html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!transporter) {
      this.logger.log(`[mail:dry-run] para=${to} assunto="${subject}"`);
      return { delivered: true };
    }

    try {
      const info = await transporter.sendMail({
        from: this.buildFrom(fromName),
        replyTo: replyTo ?? this.configService.get<string>('mail.replyTo'),
        to,
        subject,
        html,
        text: body,
        ...(headers ? { headers } : {}),
      });

      return { delivered: true, messageId: normalizeMessageId(info.messageId) };
    } catch (error) {
      return { delivered: false, error: (error as Error).message };
    }
  }

  async send(input: SendMailInput): Promise<void> {
    const result = await this.trySend(input);

    if (!result.delivered) {
      this.logger.error(
        `Falha ao enviar e-mail para ${input.to}: ${result.error}`,
      );
    }
  }

  /**
   * Troca só o nome de exibição, preservando o endereço configurado.
   *
   * `EMAIL_FROM` tanto pode ser `noreply@opusatlas.com` quanto
   * `Opus Atlas <noreply@opusatlas.com>` — o endereço é o que estiver entre os
   * sinais de menor e maior, se houver.
   */
  private buildFrom(fromName?: string): string | undefined {
    const configured = this.configService.get<string>('mail.from');

    if (!fromName || !configured) {
      return configured;
    }

    const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;

    return `${fromName.replace(/[<>"\r\n]/g, '')} <${address}>`;
  }

  /** Base URL of the site: images live in its `public/email`, links point to it. */
  private get site(): string {
    return (
      this.configService.get<string>('mail.assetsBaseUrl') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /**
   * The language the recipient chose on the site (`User.language`), else
   * the one of their newsletter subscription; Portuguese otherwise. A failed
   * lookup never holds an email back.
   */
  private async languageOf(to: string): Promise<EmailLanguage> {
    try {
      const email = to.trim().toLowerCase();
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: { language: true },
      });
      if (user?.language) return user.language === 'en' ? 'en' : 'pt';
      const subscriber = await this.prisma.newsletterSubscriber.findUnique({
        where: { email },
        select: { language: true },
      });
      return subscriber?.language?.startsWith('en') ? 'en' : 'pt';
    } catch {
      return 'pt';
    }
  }

  /**
   * Renders the D layout in the recipient's language and returns the
   * message, with its plain-text twin. The text comes from a template in
   * `./templates`, which writes both versions of each line side by side.
   */
  private async compose(
    to: string,
    build: (ctx: TemplateContext) => EmailSpec,
    extra: Pick<SendMailInput, 'replyTo' | 'headers'> = {},
    forced?: EmailLanguage,
  ): Promise<SendMailInput> {
    // `forced`: quem escreveu agora, na língua em que está vendo o site, e
    // pode nem ter conta (o formulário de contato) — vale mais que o cadastro.
    const language = forced ?? (await this.languageOf(to));
    const say: Say = (pt, en) => (language === 'en' ? en : pt);
    const { subject, html, text } = renderEmail(
      {
        ...build({ say, language, site: this.site, now: new Date() }),
        language,
      },
      this.site,
    );
    return { to, subject, html, text, ...extra };
  }

  async sendAccountConfirmationEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.accountConfirmation(data, ctx)),
    );
  }

  async sendWelcomeEmail(
    to: string,
    data: { firstName: string; onboardingUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.welcome(data, ctx)),
    );
  }

  async sendTeacherInvitationEmail(
    to: string,
    data: {
      firstName: string;
      invitedByName: string;
      acceptUrl: string;
      declineUrl: string;
      /** Plano que vem com o convite (concedido no aceite). */
      planGrant?: { planName: string; until: string | null };
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.teacherInvitation(data, ctx)),
    );
  }

  async sendPortalNotice(
    to: string,
    data: {
      firstName: string;
      title: string;
      message: string;
      actionText?: string | null;
      actionUrl?: string | null;
    },
  ): Promise<SendMailResult> {
    return this.trySend(
      await this.compose(to, (ctx) => templates.portalNotice(data, ctx)),
    );
  }

  async sendPasswordResetEmail(
    to: string,
    data: { firstName: string; resetUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.passwordReset(data, ctx)),
    );
  }

  async sendGoogleAccountResetNotice(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.googleAccountResetNotice(data, ctx),
      ),
    );
  }

  async sendPasswordChangedEmail(
    to: string,
    data: { firstName: string; ipAddress: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.passwordChanged(data, ctx)),
    );
  }

  async sendEmailChangeRequestEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.emailChangeRequest(data, ctx)),
    );
  }

  async sendEmailChangedToOldAddress(
    to: string,
    data: { firstName: string; newEmail: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.emailChangedToOldAddress(data, ctx),
      ),
    );
  }

  async sendEmailChangeConfirmedToNewAddress(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.emailChangeConfirmedToNewAddress(data, ctx),
      ),
    );
  }

  async sendAccountDeletedFarewellEmail(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.accountDeletedFarewell(data, ctx),
      ),
    );
  }

  async sendContactSupportNotification(data: {
    ticketId: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    category: string;
    priority: string;
    prioritySupport?: boolean;
    plan?: string;
  }): Promise<void> {
    await this.send(
      await this.compose(
        this.configService.get<string>('mail.supportTo')!,
        (ctx) => templates.contactSupportNotification(data, ctx),
        { replyTo: data.email },
      ),
    );
  }

  async sendContactConfirmationEmail(
    to: string,
    data: { firstName: string; ticketId: string },
    language?: EmailLanguage,
  ): Promise<void> {
    await this.send(
      await this.compose(
        to,
        (ctx) => templates.contactConfirmation(data, ctx),
        {},
        language,
      ),
    );
  }

  async sendNewsletterConfirmationEmail(
    to: string,
    data: {
      firstName: string;
      confirmationUrl: string;
      unsubscribeUrl: string;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.newsletterConfirmation(data, ctx),
      ),
    );
  }

  async sendNewsletterWelcomeEmail(
    to: string,
    data: { firstName: string; unsubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.newsletterWelcome(data, ctx), {
        headers: { 'List-Unsubscribe': `<${data.unsubscribeUrl}>` },
      }),
    );
  }

  async sendNewsletterUnsubscribeConfirmationEmail(
    to: string,
    data: { firstName: string; resubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.newsletterUnsubscribeConfirmation(data, ctx),
      ),
    );
  }

  async sendPaymentApprovedEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      billingPeriod?: BillingPeriod;
      amount: number;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.paymentApproved(data, ctx)),
    );
  }

  async sendSubscriptionCancelledEmail(
    to: string,
    data: { firstName: string; planType: PlanType },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.subscriptionCancelled(data, ctx),
      ),
    );
  }

  async sendPlanChangedEmail(
    to: string,
    data: {
      firstName: string;
      fromPlan: PlanType;
      toPlan: PlanType;
      changeType: 'UPGRADE' | 'DOWNGRADE';
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.planChanged(data, ctx)),
    );
  }

  async sendRenewalReminderEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      renewalDate: Date;
      amount: number;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.renewalReminder(data, ctx)),
    );
  }

  async sendTrialExpiringEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      daysRemaining: number;
      chargeDate: Date;
      amount: number;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.trialExpiring(data, ctx)),
    );
  }

  async sendTrialStartedEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      chargeDate: Date;
      amount: number;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.trialStarted(data, ctx)),
    );
  }

  async sendPaymentFailedEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      amount: number;
      graceEndsAt: Date;
      afterTrial: boolean;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.paymentFailed(data, ctx)),
    );
  }

  async sendPaymentActionRequiredEmail(
    to: string,
    data: {
      firstName: string;
      planType: PlanType;
      amount: number;
      url: string;
      afterTrial: boolean;
    },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) =>
        templates.paymentActionRequired(data, ctx),
      ),
    );
  }

  async sendSubscriptionEndedEmail(
    to: string,
    data: { firstName: string; planType: PlanType },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (ctx) => templates.subscriptionEnded(data, ctx)),
    );
  }
}

/**
 * O `Message-ID` sem os sinais de menor e maior.
 *
 * O cabeçalho vem como `<abc@dominio>`, e é assim que o nodemailer o devolve.
 * Provedores costumam publicar o mesmo valor **sem** os sinais nos eventos de
 * webhook; guardar as duas formas diferentes faria o par nunca fechar.
 */
export function normalizeMessageId(messageId?: string): string | undefined {
  return messageId?.replace(/^</, '').replace(/>$/, '') || undefined;
}
