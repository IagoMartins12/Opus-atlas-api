import type { EmailSpec } from '../email-layout';
import { LOCALES, type TemplateContext } from './context';

/** Account and security: confirm, welcome, password, email change, farewell. */

export function accountConfirmation(
  data: { firstName: string; confirmationUrl: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

/**
 * Boas-vindas de quem entrou pela primeira vez com o Google. A conta nasce
 * confirmada — o Google já provou o e-mail —, então não há confirmação a
 * mandar; o link leva a completar o perfil.
 */
export function welcome(
  data: { firstName: string; onboardingUrl: string },
  { say, site }: TemplateContext,
): EmailSpec {
  return {
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
        url: `${site}/composers`,
      },
      {
        title: say('Monte a sua lista', 'Build your list'),
        text: say(
          'Marque uma obra como "Quero estudar" e ela entra na sua estante.',
          'Mark a piece as "Want to study" and it joins your shelf.',
        ),
        label: say('Abrir meus estudos', 'Open my studies'),
        url: `${site}/learning`,
      },
      {
        title: say('Dê aula por aqui', 'Teach here'),
        text: say(
          'Se você ensina, o portal do professor acompanha cada aluno.',
          'If you teach, the teacher portal follows each student.',
        ),
        label: say('Conhecer o portal', 'See the portal'),
        url: `${site}/for-teachers`,
      },
    ],
    footer: 'conta',
  };
}

export function passwordReset(
  data: { firstName: string; resetUrl: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

export function googleAccountResetNotice(
  data: { firstName: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

export function passwordChanged(
  data: { firstName: string; ipAddress: string },
  { say, language }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

/** Enviado para o NOVO e-mail quando a troca é solicitada — o link confirma a troca. */
export function emailChangeRequest(
  data: { firstName: string; confirmationUrl: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
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
  };
}

export function emailChangedToOldAddress(
  data: { firstName: string; newEmail: string },
  { say }: TemplateContext,
): EmailSpec {
  return {
    subject: say(
      'O e-mail da sua conta mudou',
      'Your account email has changed',
    ),
    preheader: say(
      `A conta agora usa ${data.newEmail}.`,
      `The account now uses ${data.newEmail}.`,
    ),
    title: say('O e-mail da sua conta mudou', 'Your account email has changed'),
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
    details: [{ label: say('Novo e-mail', 'New email'), value: data.newEmail }],
    footer: 'seguranca',
    footerText: say(
      'Avisamos o endereço antigo sempre que o e-mail da conta muda.',
      'We notify the old address whenever the account email changes.',
    ),
  };
}

export function emailChangeConfirmedToNewAddress(
  data: { firstName: string },
  { say, site }: TemplateContext,
): EmailSpec {
  return {
    subject: say(
      'Pronto: este é o e-mail da sua conta',
      'Done: this is your account email',
    ),
    preheader: say(
      'Os avisos do Opus Atlas passam a chegar aqui.',
      'Opus Atlas notices will arrive here from now on.',
    ),
    title: say('Tudo certo com o seu novo e-mail', 'Your new email is all set'),
    paragraphs: [
      say(
        `Olá, ${data.firstName}. A partir de agora, os avisos do Opus Atlas chegam neste endereço.`,
        `Hi, ${data.firstName}. From now on, Opus Atlas notices arrive at this address.`,
      ),
    ],
    emblem: 'envelope',
    action: {
      label: say('Abrir meu perfil', 'Open my profile'),
      url: `${site}/profile`,
    },
    footer: 'conta',
  };
}

export function accountDeletedFarewell(
  data: { firstName: string },
  { say, language, site }: TemplateContext,
): EmailSpec {
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
      url: site,
    },
    footer: 'seguranca',
    footerText: say(
      'Não pediu a exclusão? Escreva para contato@opusatlas.com o quanto antes.',
      "Didn't ask for this? Write to contato@opusatlas.com as soon as you can.",
    ),
  };
}
