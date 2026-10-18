import { BillingPeriod, PlanType } from '@prisma/client';
import type { EmailLanguage, EmailSpec } from '../email-layout';
import { LOCALES, type TemplateContext } from './context';

/** Billing: payment, cancellation, plan change, renewal, end of trial. */

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

export function paymentApproved(
  data: {
    firstName: string;
    planType: PlanType;
    billingPeriod?: BillingPeriod;
    amount: number;
  },
  { say, language, site, now }: TemplateContext,
): EmailSpec {
  const teaches = data.planType === 'MENTOR' || data.planType === 'MAESTRO';

  const plan = PLAN_NAMES[language][data.planType];
  const period = data.billingPeriod
    ? BILLING_PERIOD_NAMES[language][data.billingPeriod]
    : null;
  const amount = formatBRL(data.amount, language);
  const today = now.toLocaleDateString(LOCALES[language], {
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
    title: say('Tudo certo com o seu pagamento', 'Your payment went through'),
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
          url: `${site}/teacher`,
        }
      : {
          label: say('Enviar ao acervo', 'Upload to the library'),
          url: `${site}/upload`,
        },
    highlight: {
      value: amount,
      label: period ? `${plan} · ${period.toLowerCase()}` : plan,
    },
    details: [
      { label: say('Plano', 'Plan'), value: plan },
      ...(period ? [{ label: say('Período', 'Billing'), value: period }] : []),
      { label: say('Valor', 'Amount'), value: amount },
      { label: say('Data', 'Date'), value: today },
    ],
    footer: 'cobranca',
  };
}

export function subscriptionCancelled(
  data: { firstName: string; planType: PlanType },
  { say, language, site }: TemplateContext,
): EmailSpec {
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
      url: `${site}/pricing`,
    },
    footer: 'cobranca',
  };
}

export function planChanged(
  data: {
    firstName: string;
    fromPlan: PlanType;
    toPlan: PlanType;
    changeType: 'UPGRADE' | 'DOWNGRADE';
  },
  { say, language, site }: TemplateContext,
): EmailSpec {
  const upgrade = data.changeType === 'UPGRADE';

  const from = PLAN_NAMES[language][data.fromPlan];
  const toPlan = PLAN_NAMES[language][data.toPlan];
  return {
    subject: upgrade
      ? say(`Seu plano agora é ${toPlan}`, `Your plan is now ${toPlan}`)
      : say(`Troca para ${toPlan} agendada`, `Change to ${toPlan} scheduled`),
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
      url: `${site}/profile`,
    },
    footer: 'cobranca',
  };
}

export function renewalReminder(
  data: {
    firstName: string;
    planType: PlanType;
    renewalDate: Date;
    amount: number;
  },
  { say, language, site }: TemplateContext,
): EmailSpec {
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
      url: `${site}/profile`,
    },
    footer: 'cobranca',
  };
}

function longDate(date: Date, language: EmailLanguage): string {
  return date.toLocaleDateString(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  });
}

/** The trial began with the card accepted: when the first charge happens, and how much. */
export function trialStarted(
  data: {
    firstName: string;
    planType: PlanType;
    chargeDate: Date;
    amount: number;
  },
  { say, language, site }: TemplateContext,
): EmailSpec {
  const plan = PLAN_NAMES[language][data.planType];
  const date = longDate(data.chargeDate, language);
  const amount = formatBRL(data.amount, language);
  return {
    subject: say(
      `Seu teste do ${plan} começou`,
      `Your ${plan} trial has started`,
    ),
    preheader: say(
      `Nada é cobrado até ${date}.`,
      `Nothing is charged until ${date}.`,
    ),
    title: say('Teste grátis começou', 'Your free trial has started'),
    paragraphs: [
      say(
        `Olá, ${data.firstName}. O plano ${plan} já está liberado. Nada é cobrado até ${date}; nesse dia, o cartão cadastrado paga ${amount} e a assinatura segue.`,
        `Hi, ${data.firstName}. Your ${plan} plan is unlocked. Nothing is charged until ${date}; on that day, the card on file pays ${amount} and the subscription continues.`,
      ),
      say(
        'Se não quiser continuar, cancele antes dessa data em Meu perfil → Configurações da Conta. Nada será cobrado.',
        'If you do not want to continue, cancel before that date in My profile → Account settings. Nothing will be charged.',
      ),
    ],
    emblem: 'recibo',
    highlight: {
      value: amount,
      label: say(`primeira cobrança em ${date}`, `first charge on ${date}`),
    },
    action: {
      label: say('Ver minha assinatura', 'See my subscription'),
      url: `${site}/profile`,
    },
    footer: 'cobranca',
  };
}

export function trialExpiring(
  data: {
    firstName: string;
    planType: PlanType;
    daysRemaining: number;
    chargeDate: Date;
    amount: number;
  },
  { say, language, site }: TemplateContext,
): EmailSpec {
  const one = data.daysRemaining === 1;

  const plan = PLAN_NAMES[language][data.planType];
  const days = one
    ? say('1 dia', '1 day')
    : say(`${data.daysRemaining} dias`, `${data.daysRemaining} days`);
  const date = longDate(data.chargeDate, language);
  const amount = formatBRL(data.amount, language);
  return {
    subject: say(
      `Seu teste do ${plan} termina em ${days}`,
      `Your ${plan} trial ends in ${days}`,
    ),
    preheader: say(
      `Em ${date}, o cartão cadastrado paga ${amount}.`,
      `On ${date}, the card on file pays ${amount}.`,
    ),
    title: say('Seu período de teste está acabando', 'Your trial is ending'),
    paragraphs: [
      say(
        `Olá, ${data.firstName}. O teste do plano ${plan} termina em ${days}. Em ${date}, o cartão cadastrado paga ${amount} e você continua com tudo o que usa hoje.`,
        `Hi, ${data.firstName}. Your ${plan} trial ends in ${days}. On ${date}, the card on file pays ${amount} and you keep everything you use today.`,
      ),
      say(
        'Se não quiser continuar, cancele antes em Meu perfil → Configurações da Conta. Nada será cobrado.',
        'If you do not want to continue, cancel before then in My profile → Account settings. Nothing will be charged.',
      ),
    ],
    emblem: 'recibo',
    highlight: {
      value: amount,
      label: say(`em ${date}`, `on ${date}`),
    },
    action: {
      label: say('Ver minha assinatura', 'See my subscription'),
      url: `${site}/profile`,
    },
    footer: 'cobranca',
  };
}

/** A charge was declined: what happened, what to do and the deadline. */
export function paymentFailed(
  data: {
    firstName: string;
    planType: PlanType;
    amount: number;
    graceEndsAt: Date;
    afterTrial: boolean;
  },
  { say, language, site }: TemplateContext,
): EmailSpec {
  const plan = PLAN_NAMES[language][data.planType];
  const date = longDate(data.graceEndsAt, language);
  const amount = formatBRL(data.amount, language);
  return {
    subject: say(
      `Não conseguimos cobrar o plano ${plan}`,
      `We could not charge your ${plan} plan`,
    ),
    preheader: say(
      `Atualize o cartão até ${date} para continuar.`,
      `Update your card by ${date} to keep going.`,
    ),
    title: say('O pagamento foi recusado', 'The payment was declined'),
    paragraphs: [
      data.afterTrial
        ? say(
            `Olá, ${data.firstName}. O teste do plano ${plan} terminou, mas o cartão cadastrado recusou a cobrança de ${amount}.`,
            `Hi, ${data.firstName}. Your ${plan} trial has ended, but the card on file declined the ${amount} charge.`,
          )
        : say(
            `Olá, ${data.firstName}. O cartão cadastrado recusou a renovação do plano ${plan} (${amount}).`,
            `Hi, ${data.firstName}. The card on file declined the renewal of your ${plan} plan (${amount}).`,
          ),
      say(
        `O plano continua liberado até ${date}. Atualize o cartão em Meu perfil → Configurações da Conta → Pagamento e faturas; a cobrança é feita de novo sozinha. Sem pagamento até lá, a assinatura é encerrada e a conta volta ao Free, com o seu histórico.`,
        `The plan stays unlocked until ${date}. Update your card in My profile → Account settings → Payment and invoices; the charge is retried automatically. Without payment by then, the subscription ends and the account returns to Free, keeping your history.`,
      ),
    ],
    emblem: 'recibo',
    highlight: {
      value: date,
      label: say(
        'prazo para atualizar o cartão',
        'deadline to update your card',
      ),
    },
    action: {
      label: say('Atualizar o cartão', 'Update my card'),
      url: `${site}/profile`,
    },
    footer: 'cobranca',
  };
}

/** The grace period ended without payment: the subscription is over. */
export function subscriptionEnded(
  data: { firstName: string; planType: PlanType },
  { say, language, site }: TemplateContext,
): EmailSpec {
  const plan = PLAN_NAMES[language][data.planType];
  return {
    subject: say(
      `Sua assinatura do ${plan} foi encerrada`,
      `Your ${plan} subscription has ended`,
    ),
    preheader: say(
      'O pagamento não foi concluído no prazo.',
      'The payment was not completed in time.',
    ),
    title: say('Assinatura encerrada', 'Subscription ended'),
    paragraphs: [
      say(
        `Olá, ${data.firstName}. Como a cobrança do plano ${plan} não foi concluída no prazo, a assinatura foi encerrada e nada mais será cobrado.`,
        `Hi, ${data.firstName}. Since the ${plan} charge was not completed in time, the subscription has ended and nothing else will be charged.`,
      ),
      say(
        'A conta voltou ao Free, com favoritos, listas e anotações guardados. Para voltar ao plano, é só assinar de novo.',
        'The account is back on Free, with your favorites, lists and notes kept. To return to the plan, just subscribe again.',
      ),
    ],
    emblem: 'recibo',
    action: {
      label: say('Ver os planos', 'See the plans'),
      url: `${site}/pricing`,
    },
    footer: 'cobranca',
  };
}
