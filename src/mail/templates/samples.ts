import {
  renderEmail,
  type EmailLanguage,
  type RenderedEmail,
} from '../email-layout';
import * as t from './index';
import type { TemplateContext } from './context';

export type EmailGroup =
  | 'conta'
  | 'portal'
  | 'cobranca'
  | 'contato'
  | 'newsletter';

export interface EmailSample {
  id: string;
  group: EmailGroup;
  /** How the admin list names it. */
  name: string;
  build: (ctx: TemplateContext) => ReturnType<typeof t.welcome>;
}

/**
 * Every email the platform sends, with made-up data: the previews in the
 * admin, the preview script, the test send and the snapshot tests all read
 * this list, so a new template is one line here away from being seen.
 */
export const EMAIL_SAMPLES: EmailSample[] = [
  {
    id: 'account-confirmation',
    group: 'conta',
    name: 'Confirmar a conta',
    build: (c) =>
      t.accountConfirmation(
        {
          firstName: 'Ana',
          confirmationUrl: `${c.site}/confirm-account/exemplo`,
        },
        c,
      ),
  },
  {
    id: 'welcome',
    group: 'conta',
    name: 'Boas-vindas (entrada pelo Google)',
    build: (c) =>
      t.welcome({ firstName: 'Ana', onboardingUrl: `${c.site}/profile` }, c),
  },
  {
    id: 'password-reset',
    group: 'conta',
    name: 'Nova senha',
    build: (c) =>
      t.passwordReset(
        { firstName: 'Ana', resetUrl: `${c.site}/reset-password/exemplo` },
        c,
      ),
  },
  {
    id: 'google-account-reset',
    group: 'conta',
    name: 'Nova senha de conta do Google',
    build: (c) => t.googleAccountResetNotice({ firstName: 'Ana' }, c),
  },
  {
    id: 'password-changed',
    group: 'conta',
    name: 'Senha trocada',
    build: (c) =>
      t.passwordChanged({ firstName: 'Ana', ipAddress: '189.40.0.1' }, c),
  },
  {
    id: 'email-change-request',
    group: 'conta',
    name: 'Confirmar o novo e-mail',
    build: (c) =>
      t.emailChangeRequest(
        {
          firstName: 'Ana',
          confirmationUrl: `${c.site}/confirm-email-change/exemplo`,
        },
        c,
      ),
  },
  {
    id: 'email-changed-old',
    group: 'conta',
    name: 'Aviso ao e-mail antigo',
    build: (c) =>
      t.emailChangedToOldAddress(
        { firstName: 'Ana', newEmail: 'ana.nova@exemplo.com' },
        c,
      ),
  },
  {
    id: 'email-changed-new',
    group: 'conta',
    name: 'Novo e-mail confirmado',
    build: (c) => t.emailChangeConfirmedToNewAddress({ firstName: 'Ana' }, c),
  },
  {
    id: 'account-deleted',
    group: 'conta',
    name: 'Conta excluída',
    build: (c) => t.accountDeletedFarewell({ firstName: 'Ana' }, c),
  },
  {
    id: 'teacher-invitation',
    group: 'portal',
    name: 'Convite para dar aula',
    build: (c) =>
      t.teacherInvitation(
        {
          firstName: 'Ana',
          invitedByName: 'Equipe Opus Atlas',
          acceptUrl: `${c.site}/confirm-teacher-invite/exemplo`,
          declineUrl: `${c.site}/decline-teacher-invite/exemplo`,
          planGrant: { planName: 'Mentor', until: '31/12/2026' },
        },
        c,
      ),
  },
  {
    id: 'portal-notice',
    group: 'portal',
    name: 'Aviso do portal',
    build: (c) =>
      t.portalNotice(
        {
          firstName: 'Ana',
          title: 'Aula amanhã às 15h',
          message:
            'A aula de piano com Clara está marcada para amanhã, às 15h.',
          actionText: 'Ver a aula',
          actionUrl: `${c.site}/student/lessons`,
        },
        c,
      ),
  },
  {
    id: 'payment-approved',
    group: 'cobranca',
    name: 'Pagamento confirmado',
    build: (c) =>
      t.paymentApproved(
        {
          firstName: 'Ana',
          planType: 'MENTOR',
          billingPeriod: 'MONTHLY',
          amount: 39.9,
        },
        c,
      ),
  },
  {
    id: 'subscription-cancelled',
    group: 'cobranca',
    name: 'Assinatura cancelada',
    build: (c) =>
      t.subscriptionCancelled({ firstName: 'Ana', planType: 'PLUS' }, c),
  },
  {
    id: 'plan-changed',
    group: 'cobranca',
    name: 'Troca de plano',
    build: (c) =>
      t.planChanged(
        {
          firstName: 'Ana',
          fromPlan: 'MENTOR',
          toPlan: 'MAESTRO',
          changeType: 'UPGRADE',
        },
        c,
      ),
  },
  {
    id: 'renewal-reminder',
    group: 'cobranca',
    name: 'Renovação chegando',
    build: (c) =>
      t.renewalReminder(
        {
          firstName: 'Ana',
          planType: 'PLUS',
          renewalDate: new Date('2026-11-15T12:00:00Z'),
          amount: 19.9,
        },
        c,
      ),
  },
  {
    id: 'trial-expiring',
    group: 'cobranca',
    name: 'Fim do teste',
    build: (c) =>
      t.trialExpiring(
        {
          firstName: 'Ana',
          planType: 'PLUS',
          daysRemaining: 3,
          chargeDate: new Date('2026-11-15T12:00:00Z'),
          amount: 19.9,
        },
        c,
      ),
  },
  {
    id: 'trial-started',
    group: 'cobranca',
    name: 'Teste começou',
    build: (c) =>
      t.trialStarted(
        {
          firstName: 'Ana',
          planType: 'MENTOR',
          chargeDate: new Date('2026-11-15T12:00:00Z'),
          amount: 39.9,
        },
        c,
      ),
  },
  {
    id: 'payment-failed',
    group: 'cobranca',
    name: 'Cobrança recusada',
    build: (c) =>
      t.paymentFailed(
        {
          firstName: 'Ana',
          planType: 'MENTOR',
          amount: 39.9,
          graceEndsAt: new Date('2026-11-19T12:00:00Z'),
          afterTrial: true,
        },
        c,
      ),
  },
  {
    id: 'payment-action-required',
    group: 'cobranca',
    name: 'Confirmar pagamento (3-D Secure)',
    build: (c) =>
      t.paymentActionRequired(
        {
          firstName: 'Ana',
          planType: 'MENTOR',
          amount: 39.9,
          url: 'https://invoice.stripe.com/i/exemplo',
          afterTrial: true,
        },
        c,
      ),
  },
  {
    id: 'subscription-ended',
    group: 'cobranca',
    name: 'Assinatura encerrada',
    build: (c) =>
      t.subscriptionEnded({ firstName: 'Ana', planType: 'MENTOR' }, c),
  },
  {
    id: 'contact-support',
    group: 'contato',
    name: 'Mensagem para a equipe',
    build: (c) =>
      t.contactSupportNotification(
        {
          ticketId: 'OA-1024',
          name: 'Ana Ribeiro',
          email: 'ana@exemplo.com',
          subject: 'Partitura com páginas trocadas',
          message:
            'A edição de 1830 das Mazurcas tem as páginas 3 e 4 invertidas no PDF.',
          category: 'Conteúdo',
          priority: 'Normal',
        },
        c,
      ),
  },
  {
    id: 'contact-confirmation',
    group: 'contato',
    name: 'Recebemos sua mensagem',
    build: (c) =>
      t.contactConfirmation({ firstName: 'Ana', ticketId: 'OA-1024' }, c),
  },
  {
    id: 'newsletter-confirmation',
    group: 'newsletter',
    name: 'Confirmar inscrição',
    build: (c) =>
      t.newsletterConfirmation(
        {
          firstName: 'Ana',
          confirmationUrl: `${c.site}/newsletter/success/exemplo`,
          unsubscribeUrl: `${c.site}/newsletter/unsubscribe/exemplo`,
        },
        c,
      ),
  },
  {
    id: 'newsletter-welcome',
    group: 'newsletter',
    name: 'Inscrição confirmada',
    build: (c) =>
      t.newsletterWelcome(
        {
          firstName: 'Ana',
          unsubscribeUrl: `${c.site}/newsletter/unsubscribe/exemplo`,
        },
        c,
      ),
  },
  {
    id: 'newsletter-unsubscribed',
    group: 'newsletter',
    name: 'Inscrição cancelada',
    build: (c) =>
      t.newsletterUnsubscribeConfirmation(
        {
          firstName: 'Ana',
          resubscribeUrl: `${c.site}/newsletter/resubscribe/exemplo`,
        },
        c,
      ),
  },
];

/** One sample, finished as the recipient would get it. */
export function renderSample(
  sample: EmailSample,
  language: EmailLanguage,
  site: string,
  now = new Date(),
): RenderedEmail {
  const say = (pt: string, en: string) => (language === 'en' ? en : pt);
  return renderEmail(
    { ...sample.build({ say, language, site, now }), language },
    site,
    now,
  );
}
