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

/** Writes a line in both languages; `compose` keeps the recipient's. */
type Say = (pt: string, en: string) => string;

const LOCALES: Record<EmailLanguage, string> = { pt: 'pt-BR', en: 'en-US' };

const PLAN_NAMES: Record<EmailLanguage, Record<PlanType, string>> = {
  pt: { FREE: 'Gratuito', PLUS: 'Plus', MENTOR: 'Mentor', MAESTRO: 'Maestro' },
  en: { FREE: 'Free', PLUS: 'Plus', MENTOR: 'Mentor', MAESTRO: 'Maestro' },
};

const BILLING_PERIOD_NAMES: Record<
  EmailLanguage,
  Record<BillingPeriod, string>
> = {
  pt: { MONTHLY: 'Mensal', YEARLY: 'Anual' },
  en: { MONTHLY: 'Monthly', YEARLY: 'Yearly' },
};

/** Prices are always in reais; only the number format follows the language. */
function formatBRL(amount: number, language: EmailLanguage): string {
  return new Intl.NumberFormat(LOCALES[language], {
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
   * message, with its plain-text twin. `build` writes both versions of each
   * line side by side through `say(pt, en)`.
   */
  private async compose(
    to: string,
    build: (say: Say, language: EmailLanguage) => EmailSpec,
    extra: Pick<SendMailInput, 'replyTo' | 'headers'> = {},
  ): Promise<SendMailInput> {
    const language = await this.languageOf(to);
    const say: Say = (pt, en) => (language === 'en' ? en : pt);
    const { subject, html, text } = renderEmail(
      { ...build(say, language), language },
      this.site,
    );
    return { to, subject, html, text, ...extra };
  }

  async sendAccountConfirmationEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          'Confirme seu e-mail para começar',
          'Confirm your email to get started',
        ),
        preheader: say(
          'Um toque no botão e a sua conta fica pronta.',
          'One tap on the button and your account is ready.',
        ),
        title: say(
          'Falta só confirmar que este e-mail é seu',
          'Just confirm this email is yours',
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Toque no botão para ativar a sua conta. Depois disso, favoritos, listas de estudo e anotações ficam guardados com você.`,
            `Hi, ${data.firstName}. Tap the button to activate your account. From then on, your favorites, study lists and notes stay with you.`,
          ),
        ],
        emblem: 'envelope',
        action: {
          label: say('Confirmar meu e-mail', 'Confirm my email'),
          url: data.confirmationUrl,
        },
        highlight: {
          value: say('24 horas', '24 hours'),
          label: say('para usar o link', 'to use the link'),
        },
        footer: 'seguranca',
      })),
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
      await this.compose(to, (say) => ({
        subject: say(
          'Sua estante no Opus Atlas está pronta',
          'Your Opus Atlas shelf is ready',
        ),
        preheader: say(
          'Conte o que você toca e a sua conta fica com a sua cara.',
          'Tell us what you play and the account becomes yours.',
        ),
        title: say(
          `Que bom ter você aqui, ${data.firstName}`,
          `Glad you're here, ${data.firstName}`,
        ),
        paragraphs: [
          say(
            'A partir de agora, o que você estuda fica guardado num lugar só: as obras que quer aprender, as que já aprendeu, as partituras que favoritou e as suas anotações nas margens.',
            'From now on, what you study lives in one place: the pieces you want to learn, the ones you already know, the scores you saved and your notes in the margins.',
          ),
          say(
            'Comece pelo seu perfil. Leva um minuto e deixa claro o que você toca e há quanto tempo estuda.',
            'Start with your profile. It takes a minute and says what you play and how long you have been studying.',
          ),
        ],
        emblem: 'bussola',
        action: {
          label: say('Completar meu perfil', 'Complete my profile'),
          url: data.onboardingUrl,
        },
        paths: [
          {
            title: say('Leia ouvindo', 'Read while listening'),
            text: say(
              'Abra um compositor e escute a obra enquanto lê sobre ela.',
              'Open a composer and hear the piece while you read about it.',
            ),
            label: say('Ver compositores', 'See composers'),
            url: `${this.site}/composers`,
          },
          {
            title: say('Monte a sua lista', 'Build your list'),
            text: say(
              'Marque uma obra como "Quero estudar" e ela entra na sua estante.',
              'Mark a piece as "Want to study" and it joins your shelf.',
            ),
            label: say('Abrir meus estudos', 'Open my studies'),
            url: `${this.site}/learning`,
          },
          {
            title: say('Dê aula por aqui', 'Teach here'),
            text: say(
              'Se você ensina, o portal do professor acompanha cada aluno.',
              'If you teach, the teacher portal follows each student.',
            ),
            label: say('Conhecer o portal', 'See the portal'),
            url: `${this.site}/for-teachers`,
          },
        ],
        footer: 'conta',
      })),
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
      await this.compose(to, (say) => ({
        subject: say(
          `${data.invitedByName} convidou você para dar aulas no Opus Atlas`,
          `${data.invitedByName} invited you to teach on Opus Atlas`,
        ),
        preheader: say(
          'O portal do professor está esperando por você.',
          'The teacher portal is waiting for you.',
        ),
        title: say(
          'Um convite para dar aula por aqui',
          'An invitation to teach here',
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. ${data.invitedByName} convidou você para usar o portal do professor do Opus Atlas: agenda, tarefas e o progresso de cada aluno, num lugar só.`,
            `Hi, ${data.firstName}. ${data.invitedByName} invited you to use the Opus Atlas teacher portal: schedule, assignments and each student's progress, in one place.`,
          ),
          ...(grant
            ? [
                say(
                  `Ao aceitar, você recebe o plano **${grant.planName}**${grant.until ? ` até ${grant.until}` : ', sem vencimento'}, sem custo.`,
                  `When you accept, you get the **${grant.planName}** plan${grant.until ? ` until ${grant.until}` : ' with no end date'}, free of charge.`,
                ),
              ]
            : []),
        ],
        emblem: 'turma',
        action: {
          label: say('Aceitar o convite', 'Accept the invitation'),
          url: data.acceptUrl,
        },
        secondary: { label: say('Recusar', 'Decline'), url: data.declineUrl },
        highlight: grant
          ? {
              value: grant.planName,
              label: grant.until
                ? say(
                    `sem custo até ${grant.until}`,
                    `free until ${grant.until}`,
                  )
                : say('sem custo', 'free of charge'),
            }
          : {
              value: say('30 dias', '30 days'),
              label: say('para aceitar o convite', 'to accept the invitation'),
            },
        details: grant
          ? [
              {
                label: say('Convite válido por', 'Invitation valid for'),
                value: say('30 dias', '30 days'),
              },
            ]
          : undefined,
        footer: 'conta',
      })),
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
      await this.compose(to, (say) => ({
        subject: data.title,
        preheader: data.message,
        title: data.title,
        paragraphs: [
          say(
            `Olá, ${data.firstName}. ${data.message}`,
            `Hi, ${data.firstName}. ${data.message}`,
          ),
        ],
        emblem: 'turma',
        action: data.actionUrl
          ? {
              label:
                data.actionText || say('Abrir no portal', 'Open in the portal'),
              url: data.actionUrl,
            }
          : undefined,
        footer: 'conta',
        footerText: say(
          'Você recebe este e-mail porque escolheu ser avisado por aqui. Mude em Perfil do portal › Avisos.',
          'You get this email because you chose to be notified here. Change it in Portal profile › Notices.',
        ),
      })),
    );
  }

  async sendPasswordResetEmail(
    to: string,
    data: { firstName: string; resetUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          'Seu link para criar uma nova senha',
          'Your link to create a new password',
        ),
        preheader: say('Ele vale por uma hora.', 'It works for one hour.'),
        title: say('Vamos criar uma senha nova', "Let's create a new password"),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Recebemos um pedido para trocar a senha da sua conta. Toque no botão e escolha a nova.`,
            `Hi, ${data.firstName}. We got a request to change your account password. Tap the button and choose a new one.`,
          ),
        ],
        emblem: 'chave',
        action: {
          label: say('Criar nova senha', 'Create new password'),
          url: data.resetUrl,
        },
        highlight: {
          value: say('1 hora', '1 hour'),
          label: say('para usar o link', 'to use the link'),
        },
        footer: 'seguranca',
        footerText: say(
          'Não pediu? Ignore este e-mail: a sua senha continua a mesma.',
          "Didn't ask for it? Ignore this email: your password stays the same.",
        ),
      })),
    );
  }

  async sendGoogleAccountResetNotice(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          'Sua conta entra pelo Google',
          'Your account signs in with Google',
        ),
        preheader: say(
          'Por isso não há senha do Opus Atlas para trocar.',
          "That's why there is no Opus Atlas password to change.",
        ),
        title: say(
          'Sua conta não tem senha própria',
          "Your account doesn't have its own password",
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Você entra no Opus Atlas com a sua conta Google, então a senha que vale é a do Google.`,
            `Hi, ${data.firstName}. You sign in to Opus Atlas with your Google account, so the password that counts is your Google one.`,
          ),
          say(
            'Para trocá-la, use as configurações de segurança do Google.',
            "To change it, use Google's security settings.",
          ),
        ],
        emblem: 'chave',
        action: {
          label: say('Abrir a segurança do Google', 'Open Google security'),
          url: 'https://myaccount.google.com/security',
        },
        footer: 'seguranca',
        footerText: say(
          'Recebemos um pedido de nova senha para este e-mail. Se não foi você, pode ignorar.',
          "We got a new password request for this email. If it wasn't you, you can ignore it.",
        ),
      })),
    );
  }

  async sendPasswordChangedEmail(
    to: string,
    data: { firstName: string; ipAddress: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say, language) => ({
        subject: say('Sua senha foi trocada', 'Your password was changed'),
        preheader: say(
          'Se foi você, está tudo certo.',
          'If it was you, all is well.',
        ),
        title: say('Sua senha foi trocada', 'Your password was changed'),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. A senha da sua conta acabou de ser trocada. Se foi você, não precisa fazer nada.`,
            `Hi, ${data.firstName}. Your account password was just changed. If it was you, there is nothing to do.`,
          ),
          say(
            'Se não foi, responda este e-mail agora: a equipe ajuda a recuperar a conta.',
            "If it wasn't, reply to this email now: the team will help you recover the account.",
          ),
        ],
        emblem: 'chave',
        details: [
          {
            label: say('Quando', 'When'),
            value: new Date().toLocaleString(LOCALES[language], {
              timeZone: 'America/Sao_Paulo',
            }),
          },
          { label: say('De onde (IP)', 'From (IP)'), value: data.ipAddress },
        ],
        footer: 'seguranca',
        footerText: say(
          'Enviamos este aviso sempre que a senha muda, para proteger a sua conta.',
          'We send this notice whenever the password changes, to protect your account.',
        ),
      })),
    );
  }

  /** Enviado para o NOVO e-mail quando a troca é solicitada — o link confirma a troca. */
  async sendEmailChangeRequestEmail(
    to: string,
    data: { firstName: string; confirmationUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say('Confirme o seu novo e-mail', 'Confirm your new email'),
        preheader: say(
          'Falta um toque para concluir a troca.',
          'One tap left to finish the change.',
        ),
        title: say('Este é o seu novo e-mail?', 'Is this your new email?'),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Recebemos um pedido para usar este endereço na sua conta do Opus Atlas. Confirme para concluir a troca.`,
            `Hi, ${data.firstName}. We got a request to use this address on your Opus Atlas account. Confirm to finish the change.`,
          ),
        ],
        emblem: 'envelope',
        action: {
          label: say('Confirmar novo e-mail', 'Confirm new email'),
          url: data.confirmationUrl,
        },
        highlight: {
          value: say('24 horas', '24 hours'),
          label: say('para usar o link', 'to use the link'),
        },
        footer: 'seguranca',
      })),
    );
  }

  async sendEmailChangedToOldAddress(
    to: string,
    data: { firstName: string; newEmail: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          'O e-mail da sua conta mudou',
          'Your account email has changed',
        ),
        preheader: say(
          `A conta agora usa ${data.newEmail}.`,
          `The account now uses ${data.newEmail}.`,
        ),
        title: say(
          'O e-mail da sua conta mudou',
          'Your account email has changed',
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. A sua conta do Opus Atlas agora usa outro endereço de e-mail.`,
            `Hi, ${data.firstName}. Your Opus Atlas account now uses a different email address.`,
          ),
          say(
            'Se não foi você, responda este e-mail agora para a equipe ajudar.',
            "If it wasn't you, reply to this email now so the team can help.",
          ),
        ],
        emblem: 'envelope',
        details: [
          { label: say('Novo e-mail', 'New email'), value: data.newEmail },
        ],
        footer: 'seguranca',
        footerText: say(
          'Avisamos o endereço antigo sempre que o e-mail da conta muda.',
          'We notify the old address whenever the account email changes.',
        ),
      })),
    );
  }

  async sendEmailChangeConfirmedToNewAddress(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          'Pronto: este é o e-mail da sua conta',
          'Done: this is your account email',
        ),
        preheader: say(
          'Os avisos do Opus Atlas passam a chegar aqui.',
          'Opus Atlas notices will arrive here from now on.',
        ),
        title: say(
          'Tudo certo com o seu novo e-mail',
          'Your new email is all set',
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. A partir de agora, os avisos do Opus Atlas chegam neste endereço.`,
            `Hi, ${data.firstName}. From now on, Opus Atlas notices arrive at this address.`,
          ),
        ],
        emblem: 'envelope',
        action: {
          label: say('Abrir meu perfil', 'Open my profile'),
          url: `${this.site}/profile`,
        },
        footer: 'conta',
      })),
    );
  }

  async sendAccountDeletedFarewellEmail(
    to: string,
    data: { firstName: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say, language) => {
        const when = new Date().toLocaleDateString(LOCALES[language], {
          timeZone: 'America/Sao_Paulo',
        });
        return {
          subject: say('Sua conta foi excluída', 'Your account was deleted'),
          preheader: say(
            'Obrigado pelo tempo que você passou com a gente.',
            'Thank you for the time you spent with us.',
          ),
          title: say(
            `Até a próxima, ${data.firstName}`,
            `See you around, ${data.firstName}`,
          ),
          paragraphs: [
            say(
              `A sua conta do Opus Atlas foi excluída em ${when}, como você pediu.`,
              `Your Opus Atlas account was deleted on ${when}, as you asked.`,
            ),
            say(
              'A enciclopédia e as partituras continuam abertas, sem conta, sempre que você quiser voltar.',
              'The encyclopedia and the scores stay open, no account needed, whenever you want to come back.',
            ),
          ],
          emblem: 'lua',
          action: {
            label: say('Abrir o Opus Atlas', 'Open Opus Atlas'),
            url: this.site,
          },
          footer: 'seguranca',
          footerText: say(
            'Não pediu a exclusão? Escreva para contato@opusatlas.com o quanto antes.',
            "Didn't ask for this? Write to contato@opusatlas.com as soon as you can.",
          ),
        };
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
      await this.compose(
        this.configService.get<string>('mail.supportTo')!,
        () => ({
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
        }),
        { replyTo: data.email },
      ),
    );
  }

  async sendContactConfirmationEmail(
    to: string,
    data: { firstName: string; ticketId: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say(
          `Recebemos sua mensagem [${data.ticketId}]`,
          `We got your message [${data.ticketId}]`,
        ),
        preheader: say(
          'A equipe responde por este mesmo e-mail.',
          'The team replies to this same email.',
        ),
        title: say('Recebemos a sua mensagem', 'We got your message'),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. A equipe já foi avisada e responde por este mesmo e-mail, normalmente em até 24 horas nos dias úteis.`,
            `Hi, ${data.firstName}. The team has been notified and will reply to this same email, usually within 24 hours on business days.`,
          ),
        ],
        emblem: 'envelope',
        highlight: {
          value: data.ticketId,
          label: say('número do atendimento', 'ticket number'),
        },
        footer: 'conta',
        footerText: say(
          'Para acrescentar algo, responda este e-mail.',
          'To add something, reply to this email.',
        ),
      })),
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
      await this.compose(to, (say) => ({
        subject: say(
          'Confirme sua inscrição na newsletter',
          'Confirm your newsletter subscription',
        ),
        preheader: say(
          'Falta um toque para começar a receber.',
          'One tap left to start receiving it.',
        ),
        title: say(
          'Falta um toque para receber a newsletter',
          'One tap away from the newsletter',
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Toque no botão para confirmar que quer receber a newsletter do Opus Atlas: histórias de compositores, obras para conhecer e novidades do acervo.`,
            `Hi, ${data.firstName}. Tap the button to confirm you want the Opus Atlas newsletter: stories about composers, pieces to discover and what's new in the library.`,
          ),
        ],
        emblem: 'lua',
        action: {
          label: say('Confirmar inscrição', 'Confirm subscription'),
          url: data.confirmationUrl,
        },
        secondary: {
          label: say('Não fui eu', "It wasn't me"),
          url: data.unsubscribeUrl,
        },
        highlight: {
          value: say('48 horas', '48 hours'),
          label: say('para usar o link', 'to use the link'),
        },
        footer: 'newsletter',
        footerText: say(
          'Se você não pediu, ignore este e-mail: sem a confirmação, nada chega.',
          "If you didn't ask for this, ignore this email: without confirmation, nothing arrives.",
        ),
      })),
    );
  }

  /** Enviado depois que o double opt-in é confirmado com sucesso. */
  async sendNewsletterWelcomeEmail(
    to: string,
    data: { firstName: string; unsubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(
        to,
        (say) => ({
          subject: say('Inscrição confirmada', 'Subscription confirmed'),
          preheader: say(
            'A newsletter do Opus Atlas vai chegar por aqui.',
            'The Opus Atlas newsletter will arrive here.',
          ),
          title: say(
            `Você está na lista, ${data.firstName}`,
            `You're on the list, ${data.firstName}`,
          ),
          paragraphs: [
            say(
              'A newsletter do Opus Atlas vai chegar por aqui, com histórias de compositores, obras para conhecer e novidades do acervo.',
              "The Opus Atlas newsletter will arrive here, with stories about composers, pieces to discover and what's new in the library.",
            ),
          ],
          emblem: 'lua',
          action: {
            label: say('Ler o blog enquanto isso', 'Read the blog meanwhile'),
            url: `${this.site}/blog`,
          },
          footer: 'newsletter',
          unsubscribe: {
            label: say('Cancelar a inscrição', 'Unsubscribe'),
            url: data.unsubscribeUrl,
          },
        }),
        { headers: { 'List-Unsubscribe': `<${data.unsubscribeUrl}>` } },
      ),
    );
  }

  async sendNewsletterUnsubscribeConfirmationEmail(
    to: string,
    data: { firstName: string; resubscribeUrl: string },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say) => ({
        subject: say('Inscrição cancelada', 'Unsubscribed'),
        preheader: say(
          'Tiramos o seu e-mail da lista.',
          'We took your email off the list.',
        ),
        title: say(
          'Você não vai mais receber a newsletter',
          "You won't get the newsletter anymore",
        ),
        paragraphs: [
          say(
            `Olá, ${data.firstName}. Tiramos o seu e-mail da lista, como você pediu.`,
            `Hi, ${data.firstName}. We took your email off the list, as you asked.`,
          ),
          say(
            'Se mudar de ideia, a volta é um toque.',
            'If you change your mind, coming back is one tap.',
          ),
        ],
        emblem: 'lua',
        action: {
          label: say('Voltar a receber', 'Subscribe again'),
          url: data.resubscribeUrl,
        },
        footer: 'newsletter',
        footerText: say(
          'Este é o último e-mail da newsletter para este endereço.',
          'This is the last newsletter email to this address.',
        ),
      })),
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
    const teaches = data.planType === 'MENTOR' || data.planType === 'MAESTRO';
    await this.send(
      await this.compose(to, (say, language) => {
        const plan = PLAN_NAMES[language][data.planType];
        const period = data.billingPeriod
          ? BILLING_PERIOD_NAMES[language][data.billingPeriod]
          : null;
        const amount = formatBRL(data.amount, language);
        const today = new Date().toLocaleDateString(LOCALES[language], {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Sao_Paulo',
        });
        return {
          subject: say(
            `Pagamento confirmado: o plano ${plan} está ativo`,
            `Payment confirmed: your ${plan} plan is active`,
          ),
          preheader: teaches
            ? say(
                'O portal do professor já está aberto para você.',
                'The teacher portal is open for you.',
              )
            : say(
                'Envios ao acervo sem limite, a partir de agora.',
                'Unlimited uploads to the library, starting now.',
              ),
          title: say(
            'Tudo certo com o seu pagamento',
            'Your payment went through',
          ),
          paragraphs: [
            teaches
              ? say(
                  `Olá, ${data.firstName}. O plano ${plan} está ativo e o portal do professor já pode ser usado. Comece trazendo seus alunos para a turma.`,
                  `Hi, ${data.firstName}. Your ${plan} plan is active and the teacher portal is ready. Start by bringing your students into the class.`,
                )
              : say(
                  `Olá, ${data.firstName}. O plano ${plan} está ativo: envios ao acervo e vídeos de performance sem limite.`,
                  `Hi, ${data.firstName}. Your ${plan} plan is active: unlimited uploads to the library and performance videos.`,
                ),
          ],
          emblem: 'recibo',
          action: teaches
            ? {
                label: say('Abrir o portal', 'Open the portal'),
                url: `${this.site}/teacher`,
              }
            : {
                label: say('Enviar ao acervo', 'Upload to the library'),
                url: `${this.site}/upload`,
              },
          highlight: {
            value: amount,
            label: period ? `${plan} · ${period.toLowerCase()}` : plan,
          },
          details: [
            { label: say('Plano', 'Plan'), value: plan },
            ...(period
              ? [{ label: say('Período', 'Billing'), value: period }]
              : []),
            { label: say('Valor', 'Amount'), value: amount },
            { label: say('Data', 'Date'), value: today },
          ],
          footer: 'cobranca',
        };
      }),
    );
  }

  async sendSubscriptionCancelledEmail(
    to: string,
    data: { firstName: string; planType: PlanType },
  ): Promise<void> {
    await this.send(
      await this.compose(to, (say, language) => {
        const plan = PLAN_NAMES[language][data.planType];
        return {
          subject: say(
            'Sua assinatura foi cancelada',
            'Your subscription was cancelled',
          ),
          preheader: say(
            'O plano continua valendo até o fim do período pago.',
            'The plan stays active until the end of the paid period.',
          ),
          title: say('Assinatura cancelada', 'Subscription cancelled'),
          paragraphs: [
            say(
              `Olá, ${data.firstName}. O plano ${plan} foi cancelado e continua valendo até o fim do período já pago.`,
              `Hi, ${data.firstName}. Your ${plan} plan was cancelled and stays active until the end of the period you paid for.`,
            ),
            say(
              'Depois disso, a sua conta volta ao Free, com favoritos, listas e anotações guardados.',
              'After that, your account goes back to Free, with your favorites, lists and notes kept.',
            ),
          ],
          emblem: 'recibo',
          action: {
            label: say('Ver os planos', 'See the plans'),
            url: `${this.site}/pricing`,
          },
          footer: 'cobranca',
        };
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
    const upgrade = data.changeType === 'UPGRADE';
    await this.send(
      await this.compose(to, (say, language) => {
        const from = PLAN_NAMES[language][data.fromPlan];
        const toPlan = PLAN_NAMES[language][data.toPlan];
        return {
          subject: upgrade
            ? say(`Seu plano agora é ${toPlan}`, `Your plan is now ${toPlan}`)
            : say(
                `Troca para ${toPlan} agendada`,
                `Change to ${toPlan} scheduled`,
              ),
          preheader: upgrade
            ? say('A troca já vale.', 'The change is already in effect.')
            : say(
                'Até o fim do ciclo, tudo continua como está.',
                'Until the end of the cycle, everything stays as it is.',
              ),
          title: upgrade
            ? say('Plano trocado', 'Plan changed')
            : say('Troca de plano agendada', 'Plan change scheduled'),
          paragraphs: [
            upgrade
              ? say(
                  `Olá, ${data.firstName}. A troca de ${from} para ${toPlan} foi confirmada e já vale.`,
                  `Hi, ${data.firstName}. The change from ${from} to ${toPlan} is confirmed and already in effect.`,
                )
              : say(
                  `Olá, ${data.firstName}. A troca de ${from} para ${toPlan} foi agendada para o fim do ciclo atual. Até lá, tudo do ${from} continua valendo.`,
                  `Hi, ${data.firstName}. The change from ${from} to ${toPlan} is scheduled for the end of the current cycle. Until then, everything in ${from} stays active.`,
                ),
          ],
          emblem: 'recibo',
          details: [
            { label: say('De', 'From'), value: from },
            { label: say('Para', 'To'), value: toPlan },
            {
              label: say('Quando', 'When'),
              value: upgrade
                ? say('Agora', 'Now')
                : say('No fim do ciclo', 'At the end of the cycle'),
            },
          ],
          action: {
            label: say('Ver minha assinatura', 'See my subscription'),
            url: `${this.site}/profile`,
          },
          footer: 'cobranca',
        };
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
    await this.send(
      await this.compose(to, (say, language) => {
        const plan = PLAN_NAMES[language][data.planType];
        const date = data.renewalDate.toLocaleDateString(LOCALES[language], {
          timeZone: 'America/Sao_Paulo',
        });
        return {
          subject: say(
            `Sua assinatura renova em ${date}`,
            `Your subscription renews on ${date}`,
          ),
          preheader: say(
            `O plano ${plan} renova automaticamente.`,
            `Your ${plan} plan renews automatically.`,
          ),
          title: say(
            'Sua assinatura renova em breve',
            'Your subscription renews soon',
          ),
          paragraphs: [
            say(
              `Olá, ${data.firstName}. O plano ${plan} renova automaticamente em ${date}, no cartão cadastrado.`,
              `Hi, ${data.firstName}. Your ${plan} plan renews automatically on ${date}, on the card on file.`,
            ),
            say(
              'Se quiser trocar de plano ou cancelar antes, use Meu perfil → Configurações da Conta.',
              'To change plans or cancel before then, go to My profile → Account settings.',
            ),
          ],
          emblem: 'recibo',
          highlight: {
            value: formatBRL(data.amount, language),
            label: say(`em ${date}`, `on ${date}`),
          },
          action: {
            label: say('Ver minha assinatura', 'See my subscription'),
            url: `${this.site}/profile`,
          },
          footer: 'cobranca',
        };
      }),
    );
  }

  async sendTrialExpiringEmail(
    to: string,
    data: { firstName: string; planType: PlanType; daysRemaining: number },
  ): Promise<void> {
    const one = data.daysRemaining === 1;
    await this.send(
      await this.compose(to, (say, language) => {
        const plan = PLAN_NAMES[language][data.planType];
        const days = one
          ? say('1 dia', '1 day')
          : say(`${data.daysRemaining} dias`, `${data.daysRemaining} days`);
        return {
          subject: say(
            `Seu teste do ${plan} termina em ${days}`,
            `Your ${plan} trial ends in ${days}`,
          ),
          preheader: say(
            'Assine para continuar com tudo o que você usa.',
            'Subscribe to keep everything you use.',
          ),
          title: say(
            'Seu período de teste está acabando',
            'Your trial is ending',
          ),
          paragraphs: [
            say(
              `Olá, ${data.firstName}. O teste do plano ${plan} termina em ${days}. Assine para continuar com tudo o que você usa hoje.`,
              `Hi, ${data.firstName}. Your ${plan} trial ends in ${days}. Subscribe to keep everything you use today.`,
            ),
          ],
          emblem: 'recibo',
          highlight: {
            value: days,
            label: say('até o fim do teste', 'until the trial ends'),
          },
          action: {
            label: say('Ver os planos', 'See the plans'),
            url: `${this.site}/pricing`,
          },
          footer: 'cobranca',
        };
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
