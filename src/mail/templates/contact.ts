import type { EmailSpec } from '../email-layout';
import type { TemplateContext } from './context';

/** Contact form: the team's copy and the sender's receipt. */

/** Notificação interna para a equipe de suporte — dispara com `replyTo` do
 * próprio usuário, para permitir resposta direta pelo cliente de e-mail. */
export function contactSupportNotification(
  data: {
    ticketId: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    category: string;
    priority: string;
  },
  _ctx: TemplateContext,
): EmailSpec {
  return {
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
    footerText: 'Responda este e-mail para falar direto com quem escreveu.',
    signed: false,
  };
}

export function contactConfirmation(
  data: { firstName: string; ticketId: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}
