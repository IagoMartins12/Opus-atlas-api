import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingPeriod, PlanType } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { renderEmail, type EmailSpec } from './email-layout';

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

  /** Base URL of the site: images live in its `public/email`, links point to it. */
  private get site(): string {
    return (
      this.configService.get<string>('mail.assetsBaseUrl') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /** Renders the D layout and sends it, with its plain-text twin. */
  private compose(
    to: string,
    spec: EmailSpec,
    extra: Pick<SendMailInput, 'replyTo' | 'headers'> = {},
  ): SendMailInput {
    const { subject, html, text } = renderEmail(spec, this.site);
    return { to, subject, html, text, ...extra };
  }

  async sendAccountConfirmationEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Confirme seu e-mail para começar',
        preheader: 'Um toque no botão e a sua conta fica pronta.',
        title: 'Falta só confirmar que este e-mail é seu',
        paragraphs: [
          `Olá, ${data.firstName}. Toque no botão para ativar a sua conta. Depois disso, favoritos, listas de estudo e anotações ficam guardados com você.`,
        ],
        emblem: 'envelope',
        action: { label: 'Confirmar meu e-mail', url: data.confirmationUrl },
        highlight: { value: '24 horas', label: 'para usar o link' },
        footer: 'seguranca',
      }),
    );
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
    await this.send(
      this.compose(to, {
        subject: 'Sua estante no Opus Atlas está pronta',
        preheader: 'Conte o que você toca e a sua conta fica com a sua cara.',
        title: `Que bom ter você aqui, ${data.firstName}`,
        paragraphs: [
          'A partir de agora, o que você estuda fica guardado num lugar só: as obras que quer aprender, as que já aprendeu, as partituras que favoritou e as suas anotações nas margens.',
          'Comece pelo seu perfil. Leva um minuto e deixa claro o que você toca e há quanto tempo estuda.',
        ],
        emblem: 'bussola',
        action: { label: 'Completar meu perfil', url: data.onboardingUrl },
        paths: [
          {
            title: 'Leia ouvindo',
            text: 'Abra um compositor e escute a obra enquanto lê sobre ela.',
            label: 'Ver compositores',
            url: `${this.site}/composers`,
          },
          {
            title: 'Monte a sua lista',
            text: 'Marque uma obra como "Quero estudar" e ela entra na sua estante.',
            label: 'Abrir meus estudos',
            url: `${this.site}/learning`,
          },
          {
            title: 'Dê aula por aqui',
            text: 'Se você ensina, o portal do professor acompanha cada aluno.',
            label: 'Conhecer o portal',
            url: `${this.site}/for-teachers`,
          },
        ],
        footer: 'conta',
      }),
    );
  }

  /** Convite para dar aula no Opus Atlas, enviado quando o admin promove a conta. */
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
    const grant = data.planGrant;
    await this.send(
      this.compose(to, {
        subject: `${data.invitedByName} convidou você para dar aulas no Opus Atlas`,
        preheader: 'O portal do professor está esperando por você.',
        title: 'Um convite para dar aula por aqui',
        paragraphs: [
          `Olá, ${data.firstName}. ${data.invitedByName} convidou você para usar o portal do professor do Opus Atlas: agenda, tarefas e o progresso de cada aluno, num lugar só.`,
          ...(grant
            ? [
                `Ao aceitar, você recebe o plano **${grant.planName}**${grant.until ? ` até ${grant.until}` : ', sem vencimento'}, sem custo.`,
              ]
            : []),
        ],
        emblem: 'turma',
        action: { label: 'Aceitar o convite', url: data.acceptUrl },
        secondary: { label: 'Recusar', url: data.declineUrl },
        highlight: grant
          ? {
              value: grant.planName,
              label: grant.until ? `sem custo até ${grant.until}` : 'sem custo',
            }
          : { value: '30 dias', label: 'para aceitar o convite' },
        details: grant
          ? [{ label: 'Convite válido por', value: '30 dias' }]
          : undefined,
        footer: 'conta',
      }),
    );
  }

  /**
   * Aviso do portal por e-mail (04/10/2026) — a mesma frase do aviso que a
   * pessoa vê no portal, com o botão para a tela. Devolve o resultado: a
   * caixa de saída marca "sent" ou "failed" e tenta de novo depois.
   */
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
      this.compose(to, {
        subject: data.title,
        preheader: data.message,
        title: data.title,
        paragraphs: [`Olá, ${data.firstName}. ${data.message}`],
        emblem: 'turma',
        action: data.actionUrl
          ? { label: data.actionText || 'Abrir no portal', url: data.actionUrl }
          : undefined,
        footer: 'conta',
        footerText:
          'Você recebe este e-mail porque escolheu ser avisado por aqui. Mude em Perfil do portal › Avisos.',
      }),
    );
  }

  async sendPasswordResetEmail(
    to: string,
    data: { firstName: string; resetUrl: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Seu link para criar uma nova senha',
        preheader: 'Ele vale por uma hora.',
        title: 'Vamos criar uma senha nova',
        paragraphs: [
          `Olá, ${data.firstName}. Recebemos um pedido para trocar a senha da sua conta. Toque no botão e escolha a nova.`,
        ],
        emblem: 'chave',
        action: { label: 'Criar nova senha', url: data.resetUrl },
        highlight: { value: '1 hora', label: 'para usar o link' },
        footer: 'seguranca',
        footerText:
          'Não pediu? Ignore este e-mail: a sua senha continua a mesma.',
      }),
    );
  }

  async sendGoogleAccountResetNotice(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Sua conta entra pelo Google',
        preheader: 'Por isso não há senha do Opus Atlas para trocar.',
        title: 'Sua conta não tem senha própria',
        paragraphs: [
          `Olá, ${data.firstName}. Você entra no Opus Atlas com a sua conta Google, então a senha que vale é a do Google.`,
          'Para trocá-la, use as configurações de segurança do Google.',
        ],
        emblem: 'chave',
        action: {
          label: 'Abrir a segurança do Google',
          url: 'https://myaccount.google.com/security',
        },
        footer: 'seguranca',
        footerText:
          'Recebemos um pedido de nova senha para este e-mail. Se não foi você, pode ignorar.',
      }),
    );
  }

  async sendPasswordChangedEmail(
    to: string,
    data: { firstName: string; ipAddress: string },
  ): Promise<void> {
    const when = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    await this.send(
      this.compose(to, {
        subject: 'Sua senha foi trocada',
        preheader: 'Se foi você, está tudo certo.',
        title: 'Sua senha foi trocada',
        paragraphs: [
          `Olá, ${data.firstName}. A senha da sua conta acabou de ser trocada. Se foi você, não precisa fazer nada.`,
          'Se não foi, responda este e-mail agora: a equipe ajuda a recuperar a conta.',
        ],
        emblem: 'chave',
        details: [
          { label: 'Quando', value: when },
          { label: 'De onde (IP)', value: data.ipAddress },
        ],
        footer: 'seguranca',
        footerText:
          'Enviamos este aviso sempre que a senha muda, para proteger a sua conta.',
      }),
    );
  }

  /** Enviado para o NOVO e-mail quando a troca é solicitada — o link confirma a troca. */
  async sendEmailChangeRequestEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Confirme o seu novo e-mail',
        preheader: 'Falta um toque para concluir a troca.',
        title: 'Este é o seu novo e-mail?',
        paragraphs: [
          `Olá, ${data.firstName}. Recebemos um pedido para usar este endereço na sua conta do Opus Atlas. Confirme para concluir a troca.`,
        ],
        emblem: 'envelope',
        action: { label: 'Confirmar novo e-mail', url: data.confirmationUrl },
        highlight: { value: '24 horas', label: 'para usar o link' },
        footer: 'seguranca',
      }),
    );
  }

  async sendEmailChangedToOldAddress(
    to: string,
    data: { firstName: string; newEmail: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'O e-mail da sua conta mudou',
        preheader: `A conta agora usa ${data.newEmail}.`,
        title: 'O e-mail da sua conta mudou',
        paragraphs: [
          `Olá, ${data.firstName}. A sua conta do Opus Atlas agora usa outro endereço de e-mail.`,
          'Se não foi você, responda este e-mail agora para a equipe ajudar.',
        ],
        emblem: 'envelope',
        details: [{ label: 'Novo e-mail', value: data.newEmail }],
        footer: 'seguranca',
        footerText:
          'Avisamos o endereço antigo sempre que o e-mail da conta muda.',
      }),
    );
  }

  async sendEmailChangeConfirmedToNewAddress(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Pronto: este é o e-mail da sua conta',
        preheader: 'Os avisos do Opus Atlas passam a chegar aqui.',
        title: 'Tudo certo com o seu novo e-mail',
        paragraphs: [
          `Olá, ${data.firstName}. A partir de agora, os avisos do Opus Atlas chegam neste endereço.`,
        ],
        emblem: 'envelope',
        action: { label: 'Abrir meu perfil', url: `${this.site}/profile` },
        footer: 'conta',
      }),
    );
  }

  async sendAccountDeletedFarewellEmail(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    const when = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    await this.send(
      this.compose(to, {
        subject: 'Sua conta foi excluída',
        preheader: 'Obrigado pelo tempo que você passou com a gente.',
        title: `Até a próxima, ${data.firstName}`,
        paragraphs: [
          `A sua conta do Opus Atlas foi excluída em ${when}, como você pediu.`,
          'A enciclopédia e as partituras continuam abertas, sem conta, sempre que você quiser voltar.',
        ],
        emblem: 'lua',
        action: { label: 'Abrir o Opus Atlas', url: this.site },
        footer: 'seguranca',
        footerText:
          'Não pediu a exclusão? Escreva para contato@opusatlas.com o quanto antes.',
      }),
    );
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
    await this.send(
      this.compose(
        this.configService.get<string>('mail.supportTo')!,
        {
          subject: `[${data.ticketId}] ${data.subject}`,
          preheader: `${data.name}: ${data.message.slice(0, 90)}`,
          title: `Mensagem de ${data.name}`,
          paragraphs: [data.message],
          emblem: 'envelope',
          highlight: { value: data.ticketId, label: 'atendimento' },
          details: [
            { label: 'E-mail', value: data.email },
            { label: 'Assunto', value: data.subject },
            { label: 'Categoria', value: data.category },
            { label: 'Prioridade', value: data.priority },
          ],
          footer: 'conta',
          footerText:
            'Responda este e-mail para falar direto com quem escreveu.',
          signed: false,
        },
        { replyTo: data.email },
      ),
    );
  }

  async sendContactConfirmationEmail(
    to: string,
    data: { firstName: string; ticketId: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: `Recebemos sua mensagem [${data.ticketId}]`,
        preheader: 'A equipe responde por este mesmo e-mail.',
        title: 'Recebemos a sua mensagem',
        paragraphs: [
          `Olá, ${data.firstName}. A equipe já foi avisada e responde por este mesmo e-mail, normalmente em até 24 horas nos dias úteis.`,
        ],
        emblem: 'envelope',
        highlight: { value: data.ticketId, label: 'número do atendimento' },
        footer: 'conta',
        footerText: 'Para acrescentar algo, responda este e-mail.',
      }),
    );
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
    await this.send(
      this.compose(to, {
        subject: 'Confirme sua inscrição na newsletter',
        preheader: 'Falta um toque para começar a receber.',
        title: 'Falta um toque para receber a newsletter',
        paragraphs: [
          `Olá, ${data.firstName}. Toque no botão para confirmar que quer receber a newsletter do Opus Atlas: histórias de compositores, obras para conhecer e novidades do acervo.`,
        ],
        emblem: 'lua',
        action: { label: 'Confirmar inscrição', url: data.confirmationUrl },
        secondary: { label: 'Não fui eu', url: data.unsubscribeUrl },
        highlight: { value: '48 horas', label: 'para usar o link' },
        footer: 'newsletter',
        footerText:
          'Se você não pediu, ignore este e-mail: sem a confirmação, nada chega.',
      }),
    );
  }

  /** Enviado depois que o double opt-in é confirmado com sucesso. */
  async sendNewsletterWelcomeEmail(
    to: string,
    data: { firstName: string; unsubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      this.compose(
        to,
        {
          subject: 'Inscrição confirmada',
          preheader: 'A newsletter do Opus Atlas vai chegar por aqui.',
          title: `Você está na lista, ${data.firstName}`,
          paragraphs: [
            'A newsletter do Opus Atlas vai chegar por aqui, com histórias de compositores, obras para conhecer e novidades do acervo.',
          ],
          emblem: 'lua',
          action: {
            label: 'Ler o blog enquanto isso',
            url: `${this.site}/blog`,
          },
          footer: 'newsletter',
          unsubscribe: {
            label: 'Cancelar a inscrição',
            url: data.unsubscribeUrl,
          },
        },
        { headers: { 'List-Unsubscribe': `<${data.unsubscribeUrl}>` } },
      ),
    );
  }

  async sendNewsletterUnsubscribeConfirmationEmail(
    to: string,
    data: { firstName: string; resubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      this.compose(to, {
        subject: 'Inscrição cancelada',
        preheader: 'Tiramos o seu e-mail da lista.',
        title: 'Você não vai mais receber a newsletter',
        paragraphs: [
          `Olá, ${data.firstName}. Tiramos o seu e-mail da lista, como você pediu.`,
          'Se mudar de ideia, a volta é um toque.',
        ],
        emblem: 'lua',
        action: { label: 'Voltar a receber', url: data.resubscribeUrl },
        footer: 'newsletter',
        footerText: 'Este é o último e-mail da newsletter para este endereço.',
      }),
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
    const plan = PLAN_NAMES[data.planType];
    const period = data.billingPeriod
      ? BILLING_PERIOD_NAMES[data.billingPeriod]
      : null;
    const teaches = data.planType === 'MENTOR' || data.planType === 'MAESTRO';
    const today = new Date().toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
    await this.send(
      this.compose(to, {
        subject: `Pagamento confirmado: o plano ${plan} está ativo`,
        preheader: teaches
          ? 'O portal do professor já está aberto para você.'
          : 'Envios ao acervo sem limite, a partir de agora.',
        title: 'Tudo certo com o seu pagamento',
        paragraphs: [
          teaches
            ? `Olá, ${data.firstName}. O plano ${plan} está ativo e o portal do professor já pode ser usado. Comece trazendo seus alunos para a turma.`
            : `Olá, ${data.firstName}. O plano ${plan} está ativo: envios ao acervo e vídeos de performance sem limite.`,
        ],
        emblem: 'recibo',
        action: teaches
          ? { label: 'Abrir o portal', url: `${this.site}/teacher` }
          : { label: 'Enviar ao acervo', url: `${this.site}/upload` },
        highlight: {
          value: formatBRL(data.amount),
          label: period ? `${plan} · ${period.toLowerCase()}` : plan,
        },
        details: [
          { label: 'Plano', value: plan },
          ...(period ? [{ label: 'Período', value: period }] : []),
          { label: 'Valor', value: formatBRL(data.amount) },
          { label: 'Data', value: today },
        ],
        footer: 'cobranca',
      }),
    );
  }

  async sendSubscriptionCancelledEmail(
    to: string,
    data: { firstName: string; planType: PlanType },
  ): Promise<void> {
    const plan = PLAN_NAMES[data.planType];
    await this.send(
      this.compose(to, {
        subject: 'Sua assinatura foi cancelada',
        preheader: 'O plano continua valendo até o fim do período pago.',
        title: 'Assinatura cancelada',
        paragraphs: [
          `Olá, ${data.firstName}. O plano ${plan} foi cancelado e continua valendo até o fim do período já pago.`,
          'Depois disso, a sua conta volta ao Free, com favoritos, listas e anotações guardados.',
        ],
        emblem: 'recibo',
        action: { label: 'Ver os planos', url: `${this.site}/pricing` },
        footer: 'cobranca',
      }),
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
    const from = PLAN_NAMES[data.fromPlan];
    const toPlan = PLAN_NAMES[data.toPlan];
    const upgrade = data.changeType === 'UPGRADE';
    await this.send(
      this.compose(to, {
        subject: upgrade
          ? `Seu plano agora é ${toPlan}`
          : `Troca para ${toPlan} agendada`,
        preheader: upgrade
          ? 'A troca já vale.'
          : 'Até o fim do ciclo, tudo continua como está.',
        title: upgrade ? 'Plano trocado' : 'Troca de plano agendada',
        paragraphs: [
          upgrade
            ? `Olá, ${data.firstName}. A troca de ${from} para ${toPlan} foi confirmada e já vale.`
            : `Olá, ${data.firstName}. A troca de ${from} para ${toPlan} foi agendada para o fim do ciclo atual. Até lá, tudo do ${from} continua valendo.`,
        ],
        emblem: 'recibo',
        details: [
          { label: 'De', value: from },
          { label: 'Para', value: toPlan },
          { label: 'Quando', value: upgrade ? 'Agora' : 'No fim do ciclo' },
        ],
        action: { label: 'Ver minha assinatura', url: `${this.site}/profile` },
        footer: 'cobranca',
      }),
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
    const plan = PLAN_NAMES[data.planType];
    const date = data.renewalDate.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });
    await this.send(
      this.compose(to, {
        subject: `Sua assinatura renova em ${date}`,
        preheader: `O plano ${plan} renova automaticamente.`,
        title: 'Sua assinatura renova em breve',
        paragraphs: [
          `Olá, ${data.firstName}. O plano ${plan} renova automaticamente em ${date}, no cartão cadastrado.`,
          'Se quiser trocar de plano ou cancelar antes, use Meu perfil → Configurações da Conta.',
        ],
        emblem: 'recibo',
        highlight: { value: formatBRL(data.amount), label: `em ${date}` },
        action: { label: 'Ver minha assinatura', url: `${this.site}/profile` },
        footer: 'cobranca',
      }),
    );
  }

  async sendTrialExpiringEmail(
    to: string,
    data: { firstName: string; planType: PlanType; daysRemaining: number },
  ): Promise<void> {
    const plan = PLAN_NAMES[data.planType];
    const days =
      data.daysRemaining === 1 ? '1 dia' : `${data.daysRemaining} dias`;
    await this.send(
      this.compose(to, {
        subject: `Seu teste do ${plan} termina em ${days}`,
        preheader: 'Assine para continuar com tudo o que você usa.',
        title: 'Seu período de teste está acabando',
        paragraphs: [
          `Olá, ${data.firstName}. O teste do plano ${plan} termina em ${days}. Assine para continuar com tudo o que você usa hoje.`,
        ],
        emblem: 'recibo',
        highlight: { value: days, label: 'até o fim do teste' },
        action: { label: 'Ver os planos', url: `${this.site}/pricing` },
        footer: 'cobranca',
      }),
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
