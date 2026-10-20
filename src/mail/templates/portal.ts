import type { EmailSpec } from '../email-layout';
import type { TemplateContext } from './context';

/** The teacher portal: invitation and notices sent by email. */

/** Convite para dar aula no Opus Atlas, enviado quando o admin promove a conta. */
export function teacherInvitation(
  data: {
    firstName: string;
    invitedByName: string;
    acceptUrl: string;
    declineUrl: string;
    /** Plano que vem com o convite (concedido no aceite). */
    planGrant?: { planName: string; until: string | null };
  },
  { say }: TemplateContext,
): EmailSpec {
  const grant = data.planGrant;

  return {
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
            ? say(`sem custo até ${grant.until}`, `free until ${grant.until}`)
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
  };
}

/**
 * Aviso do portal por e-mail (04/10/2026) — a mesma frase do aviso que a
 * pessoa vê no portal, com o botão para a tela. Devolve o resultado: a
 * caixa de saída marca "sent" ou "failed" e tenta de novo depois.
 */
export function portalNotice(
  data: {
    firstName: string;
    title: string;
    message: string;
    actionText?: string | null;
    actionUrl?: string | null;
  },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}
