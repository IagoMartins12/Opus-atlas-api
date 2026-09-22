import { escapeHtml } from '../common/utils/html.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPeriod, PlanType } from '@prisma/client';
import * as nodemailer from 'nodemailer';

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

const GOLD = '#d4af37';

const PLAN_NAMES: Record<PlanType, string> = {
  FREE: 'Gratuito',
  PLUS: 'Plus',
  MENTOR: 'Mentor',
  MAESTRO: 'Maestro',
};

const BILLING_PERIOD_NAMES: Record<BillingPeriod, string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

function formatBRL(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);
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

  constructor(private readonly configService: ConfigService) {}

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

  private wrap(bodyHtml: string): string {
    return `
      <div style="background:#0d0d0d; padding:32px 16px; font-family: Arial, Helvetica, sans-serif;">
        <div style="max-width:520px; margin:0 auto; background:#1a1a1a; border:1px solid rgba(212,175,55,0.3); border-radius:12px; padding:32px; color:#e5e5e5;">
          <p style="text-align:center; color:${GOLD}; font-size:20px; font-weight:bold; margin:0 0 24px;">🎵 Opus Atlas</p>
          ${bodyHtml}
          <p style="text-align:center; color:#777; font-size:12px; margin-top:32px;">
            Se você não solicitou esta ação, pode ignorar este e-mail com segurança.
          </p>
        </div>
      </div>
    `;
  }

  async sendAccountConfirmationEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Confirme sua conta</h2>
      <p style="text-align:center;">Olá <strong>${escapeHtml(data.firstName)}</strong>, falta pouco para começar sua jornada musical.</p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.confirmationUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Confirmar e-mail
        </a>
      </div>
      <p style="text-align:center; color:#aaa; font-size:13px;">Este link expira em 24 horas.</p>
    `);

    await this.send({
      to,
      subject: '🎵 Confirme sua conta - Opus Atlas',
      html,
    });
  }

  /**
   * Boas-vindas de quem entrou pela primeira vez com o Google. A conta nasce
   * confirmada — o Google já provou o e-mail —, então não há confirmação a
   * mandar; o link leva a completar o perfil.
   */
  async sendWelcomeEmail(
    to: string,
    data: { firstName: string; onboardingUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Bem-vindo(a) ao Opus Atlas</h2>
      <p style="text-align:center;">Olá <strong>${escapeHtml(data.firstName)}</strong>, sua conta foi criada com o Google e já está pronta.</p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.onboardingUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Completar meu perfil
        </a>
      </div>
    `);

    await this.send({
      to,
      subject: '🎵 Bem-vindo(a) ao Opus Atlas',
      html,
    });
  }

  /** Convite para dar aula no Opus Atlas, enviado quando o admin promove a conta. */
  async sendTeacherInvitationEmail(
    to: string,
    data: {
      firstName: string;
      invitedByName: string;
      acceptUrl: string;
      declineUrl: string;
    },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Convite para professor</h2>
      <p style="text-align:center;">Olá <strong>${escapeHtml(data.firstName)}</strong>, ${escapeHtml(data.invitedByName)} convidou você para dar aulas no Opus Atlas.</p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${escapeHtml(data.acceptUrl)}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Aceitar convite
        </a>
      </div>
      <p style="text-align:center;"><a href="${escapeHtml(data.declineUrl)}" style="color:#aaa;">Recusar</a></p>
      <p style="text-align:center; color:#aaa; font-size:13px;">O convite vale por 30 dias.</p>
    `);

    await this.send({
      to,
      subject: '🎓 Convite para ser professor - Opus Atlas',
      html,
    });
  }

  async sendPasswordResetEmail(
    to: string,
    data: { firstName: string; resetUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Redefinir senha</h2>
      <p style="text-align:center;">Olá <strong>${escapeHtml(data.firstName)}</strong>, recebemos um pedido para redefinir sua senha.</p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.resetUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Redefinir senha
        </a>
      </div>
      <p style="text-align:center; color:#aaa; font-size:13px;">Este link expira em 1 hora.</p>
    `);

    await this.send({ to, subject: '🔒 Redefinir senha - Opus Atlas', html });
  }

  async sendGoogleAccountResetNotice(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Conta vinculada ao Google</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua conta usa login do Google e não tem senha própria.
        Para gerenciar sua senha, acesse
        <a href="https://myaccount.google.com/security" style="color:${GOLD};">as configurações de segurança do Google</a>.
      </p>
    `);

    await this.send({
      to,
      subject: 'ℹ️ Sua conta usa login do Google - Opus Atlas',
      html,
    });
  }

  async sendPasswordChangedEmail(
    to: string,
    data: { firstName: string; ipAddress: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#22c55e; margin-bottom:16px;">✅ Senha alterada</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua senha foi alterada com sucesso em
        ${new Date().toLocaleString('pt-BR')} a partir do IP ${escapeHtml(data.ipAddress)}.
      </p>
      <p style="text-align:center; color:#f59e0b;">Se não foi você, entre em contato conosco imediatamente.</p>
    `);

    await this.send({
      to,
      subject: '🔒 Senha alterada com sucesso - Opus Atlas',
      html,
    });
  }

  /** Enviado para o NOVO e-mail quando a troca é solicitada — o link confirma a troca. */
  async sendEmailChangeRequestEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Confirme seu novo e-mail</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, recebemos um pedido para usar este endereço como
        o novo e-mail da sua conta Opus Atlas.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.confirmationUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Confirmar novo e-mail
        </a>
      </div>
      <p style="text-align:center; color:#aaa; font-size:13px;">Este link expira em 24 horas.</p>
    `);

    await this.send({
      to,
      subject: '📧 Confirme seu novo e-mail - Opus Atlas',
      html,
    });
  }

  async sendEmailChangedToOldAddress(
    to: string,
    data: { firstName: string; newEmail: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Seu e-mail foi alterado</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, o e-mail da sua conta Opus Atlas foi alterado para
        <strong>${escapeHtml(data.newEmail)}</strong>. Se não foi você, entre em contato conosco imediatamente.
      </p>
    `);

    await this.send({
      to,
      subject: '⚠️ Seu e-mail foi alterado - Opus Atlas',
      html,
    });
  }

  async sendEmailChangeConfirmedToNewAddress(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#22c55e; margin-bottom:16px;">✅ E-mail confirmado</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, este e-mail agora é o endereço principal da sua conta Opus Atlas.
      </p>
    `);

    await this.send({
      to,
      subject: '✅ Novo e-mail confirmado - Opus Atlas',
      html,
    });
  }

  async sendAccountDeletedFarewellEmail(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">👋 Até logo!</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua conta Opus Atlas foi excluída com sucesso em
        ${new Date().toLocaleString('pt-BR')}. Esperamos ver você novamente algum dia.
      </p>
      <p style="text-align:center; color:#aaa; font-size:13px;">
        Se você não solicitou esta exclusão, entre em contato conosco imediatamente em
        contato@opusatlas.com.
      </p>
    `);

    await this.send({
      to,
      subject: '👋 Até logo da Opus Atlas',
      html,
    });
  }

  /** Notificação interna para a equipe de suporte — dispara com `replyTo` do
   * próprio usuário, para permitir resposta direta pelo cliente de e-mail. */
  async sendContactSupportNotification(data: {
    ticketId: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    category: string;
    priority: string;
  }): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">📬 Nova mensagem de contato</h2>
      <p style="color:#aaa; font-size:13px; text-align:center;">Ticket <strong>${escapeHtml(data.ticketId)}</strong> — categoria ${escapeHtml(data.category)}, prioridade ${escapeHtml(data.priority)}</p>
      <p><strong>Nome:</strong> ${escapeHtml(data.name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(data.email)}</p>
      <p><strong>Assunto:</strong> ${escapeHtml(data.subject)}</p>
      <div style="background:#111; padding:16px; border-radius:8px; border-left:3px solid ${GOLD}; margin-top:16px; white-space:pre-wrap;">${escapeHtml(data.message)}</div>
    `);

    await this.send({
      to: this.configService.get<string>('mail.supportTo')!,
      subject: `[${data.ticketId}] ${data.subject}`,
      html,
    });
  }

  async sendContactConfirmationEmail(
    to: string,
    data: { firstName: string; ticketId: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Mensagem recebida!</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, recebemos sua mensagem (ticket <strong>${escapeHtml(data.ticketId)}</strong>)
        e nossa equipe já foi notificada. Normalmente respondemos em até 24 horas durante dias úteis.
      </p>
    `);

    await this.send({
      to,
      subject: `Confirmação de contato [${data.ticketId}] - Opus Atlas`,
      html,
    });
  }

  /** Enviado ao inscrever/reinscrever — pede confirmação por double opt-in. */
  async sendNewsletterConfirmationEmail(
    to: string,
    data: {
      firstName: string;
      confirmationUrl: string;
      unsubscribeUrl: string;
    },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Confirme sua inscrição</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, falta um passo para receber nossa newsletter.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.confirmationUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Confirmar inscrição
        </a>
      </div>
      <p style="text-align:center; color:#aaa; font-size:13px;">Este link expira em 48 horas.</p>
      <p style="text-align:center; color:#666; font-size:11px; margin-top:24px;">
        Não era você? <a href="${data.unsubscribeUrl}" style="color:#888;">Cancelar inscrição</a>
      </p>
    `);

    await this.send({
      to,
      subject: '📬 Confirme sua inscrição na newsletter - Opus Atlas',
      html,
    });
  }

  /** Enviado depois que o double opt-in é confirmado com sucesso. */
  async sendNewsletterWelcomeEmail(
    to: string,
    data: { firstName: string; unsubscribeUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#22c55e; margin-bottom:16px;">✅ Inscrição confirmada!</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua inscrição na newsletter Opus Atlas está confirmada.
        Em breve você receberá curiosidades, novidades do catálogo e conteúdo musical selecionado.
      </p>
      <p style="text-align:center; color:#666; font-size:11px; margin-top:24px;">
        <a href="${data.unsubscribeUrl}" style="color:#888;">Cancelar inscrição</a>
      </p>
    `);

    await this.send({
      to,
      subject: '✅ Inscrição confirmada - Opus Atlas',
      html,
    });
  }

  async sendNewsletterUnsubscribeConfirmationEmail(
    to: string,
    data: { firstName: string; resubscribeUrl: string },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Inscrição cancelada</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua inscrição na newsletter Opus Atlas foi cancelada.
        Sentiremos sua falta!
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${data.resubscribeUrl}" style="background:${GOLD}; color:#000; text-decoration:none; padding:14px 28px; border-radius:8px; font-weight:bold; display:inline-block;">
          Reinscrever-se
        </a>
      </div>
    `);

    await this.send({
      to,
      subject: 'Inscrição cancelada - Opus Atlas',
      html,
    });
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
    const html = this.wrap(`
      <h2 style="text-align:center; color:#22c55e; margin-bottom:16px;">✅ Pagamento aprovado</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, seu pagamento de <strong>${formatBRL(data.amount)}</strong>
        para o plano <strong>${PLAN_NAMES[data.planType]}</strong>${data.billingPeriod ? ` (${BILLING_PERIOD_NAMES[data.billingPeriod]})` : ''}
        foi confirmado. Sua assinatura já está ativa!
      </p>
    `);

    await this.send({
      to,
      subject: '✅ Pagamento aprovado - Opus Atlas',
      html,
    });
  }

  async sendSubscriptionCancelledEmail(
    to: string,
    data: { firstName: string; planType: PlanType },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Assinatura cancelada</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua assinatura do plano <strong>${PLAN_NAMES[data.planType]}</strong>
        foi cancelada. Você continua com acesso até o fim do período já pago.
      </p>
    `);

    await this.send({ to, subject: 'Assinatura cancelada - Opus Atlas', html });
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
    const isUpgrade = data.changeType === 'UPGRADE';
    const html = this.wrap(`
      <h2 style="text-align:center; color:${isUpgrade ? '#22c55e' : '#fff'}; margin-bottom:16px;">
        ${isUpgrade ? '🚀 Upgrade confirmado' : 'Downgrade agendado'}
      </h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua troca de plano de <strong>${PLAN_NAMES[data.fromPlan]}</strong>
        para <strong>${PLAN_NAMES[data.toPlan]}</strong> foi ${isUpgrade ? 'confirmada' : 'agendada para o fim do ciclo atual'}.
      </p>
    `);

    await this.send({
      to,
      subject: isUpgrade
        ? '🚀 Upgrade confirmado - Opus Atlas'
        : 'Downgrade agendado - Opus Atlas',
      html,
    });
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
    const html = this.wrap(`
      <h2 style="text-align:center; color:#fff; margin-bottom:16px;">Sua assinatura renova em breve</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, sua assinatura <strong>${PLAN_NAMES[data.planType]}</strong>
        será renovada automaticamente em <strong>${data.renewalDate.toLocaleDateString('pt-BR')}</strong>,
        no valor de <strong>${formatBRL(data.amount)}</strong>.
      </p>
    `);

    await this.send({
      to,
      subject: 'Sua assinatura renova em breve - Opus Atlas',
      html,
    });
  }

  async sendTrialExpiringEmail(
    to: string,
    data: { firstName: string; planType: PlanType; daysRemaining: number },
  ): Promise<void> {
    const html = this.wrap(`
      <h2 style="text-align:center; color:#f59e0b; margin-bottom:16px;">⏳ Seu período de teste está acabando</h2>
      <p style="text-align:center;">
        Olá <strong>${escapeHtml(data.firstName)}</strong>, seu teste gratuito do plano <strong>${PLAN_NAMES[data.planType]}</strong>
        expira em <strong>${data.daysRemaining} dia(s)</strong>. Assine para continuar aproveitando todos os recursos.
      </p>
    `);

    await this.send({
      to,
      subject: '⏳ Seu período de teste está acabando - Opus Atlas',
      html,
    });
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
