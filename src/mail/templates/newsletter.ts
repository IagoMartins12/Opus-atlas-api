import type { EmailSpec } from '../email-layout';
import type { TemplateContext } from './context';

/** Newsletter subscription: confirm, welcome, unsubscribed. */

/** Enviado ao inscrever/reinscrever — pede confirmação por double opt-in. */
export function newsletterConfirmation(
  data: {
    firstName: string;
    confirmationUrl: string;
    unsubscribeUrl: string;
  },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

/** Enviado depois que o double opt-in é confirmado com sucesso. */
export function newsletterWelcome(
  data: { firstName: string; unsubscribeUrl: string },
  { say, site }: TemplateContext,
): EmailSpec {
  return {
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
      url: `${site}/blog`,
    },
    footer: 'newsletter',
    unsubscribe: {
      label: say('Cancelar a inscrição', 'Unsubscribe'),
      url: data.unsubscribeUrl,
    },
  };
}

export function newsletterUnsubscribeConfirmation(
  data: { firstName: string; resubscribeUrl: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}
