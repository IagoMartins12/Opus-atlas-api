import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MrrService } from './mrr.service';
import { StripeService } from './stripe.service';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import { SubscriptionsService } from './subscriptions.service';

const DAY = 24 * 60 * 60 * 1000;

describe('SubscriptionsCronService', () => {
  let prisma: {
    subscription: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    subscriptionHistory: { findFirst: jest.Mock; create: jest.Mock };
  };
  let subscriptions: { updateUserPlanCache: jest.Mock };
  let mail: {
    sendTrialExpiringEmail: jest.Mock;
    sendRenewalReminderEmail: jest.Mock;
    sendSubscriptionEndedEmail: jest.Mock;
  };
  let stripe: { cancelSubscriptionNow: jest.Mock };
  let mrr: { takeSnapshot: jest.Mock };
  let service: SubscriptionsCronService;

  /** Cada etapa do cron faz um `findMany` com um filtro próprio. */
  const rowsFor = (rows: {
    expiring?: unknown[];
    expiredTrials?: unknown[];
    renewals?: unknown[];
    expired?: unknown[];
  }) =>
    prisma.subscription.findMany.mockImplementation(({ where }) => {
      if (where.status === 'TRIAL' && where.trialEndDate?.gte)
        return Promise.resolve(rows.expiring ?? []);
      if (where.status === 'TRIAL')
        return Promise.resolve(rows.expiredTrials ?? []);
      if (where.status === 'ACTIVE')
        return Promise.resolve(rows.renewals ?? []);
      return Promise.resolve(rows.expired ?? []);
    });

  beforeEach(() => {
    prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      subscriptionHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    subscriptions = {
      updateUserPlanCache: jest.fn().mockResolvedValue(undefined),
    };
    mail = {
      sendTrialExpiringEmail: jest.fn().mockResolvedValue(undefined),
      sendRenewalReminderEmail: jest.fn().mockResolvedValue(undefined),
      sendSubscriptionEndedEmail: jest.fn().mockResolvedValue(undefined),
    };
    stripe = { cancelSubscriptionNow: jest.fn().mockResolvedValue(undefined) };
    mrr = { takeSnapshot: jest.fn().mockResolvedValue({}) };
    service = new SubscriptionsCronService(
      prisma as unknown as PrismaService,
      subscriptions as unknown as SubscriptionsService,
      mail as unknown as MailService,
      stripe as unknown as StripeService,
      mrr as unknown as MrrService,
    );
  });

  // O MRR de cada dia é um retrato; o job diário tira o de hoje, depois de
  // expirar o que venceu, para ele já refletir o dia.
  it('tira o retrato do MRR ao fim do job; se falhar, só registra o erro', async () => {
    const ok = await service.checkSubscriptions();
    expect(mrr.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(ok.errors).toEqual([]);

    mrr.takeSnapshot.mockRejectedValue(new Error('banco fora'));
    const falhou = await service.checkSubscriptions();
    expect(falhou.errors).toEqual(['Retrato do MRR: banco fora']);
  });

  it('avisa teste acabando, com data e valor da cobrança, uma vez por dia', async () => {
    const trialEndDate = new Date(Date.now() + 2 * DAY - 1000);
    rowsFor({
      expiring: [
        {
          id: 's1',
          userId: 'u1',
          planType: 'PLUS',
          price: 19.9,
          trialEndDate,
          user: { email: 'a@x.com', firstName: null },
        },
        {
          id: 's2',
          userId: 'u2',
          planType: 'PLUS',
          trialEndDate: new Date(),
          user: { email: null },
        },
      ],
    });

    const result = await service.checkSubscriptions();

    expect(mail.sendTrialExpiringEmail).toHaveBeenCalledWith('a@x.com', {
      firstName: 'Usuário',
      planType: 'PLUS',
      daysRemaining: 2,
      chargeDate: trialEndDate,
      amount: 19.9,
    });
    expect(result.trialsExpiring).toBe(1);
    expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'TRIAL_EXPIRING_NOTIFICATION' }),
    });
  });

  it('já avisado neste teste não recebe de novo, seja quando for', async () => {
    rowsFor({
      expiring: [
        { id: 's1', trialEndDate: new Date(), user: { email: 'a@x.com' } },
      ],
    });
    prisma.subscriptionHistory.findFirst.mockResolvedValue({ id: 'h' });

    await service.checkSubscriptions();

    expect(mail.sendTrialExpiringEmail).not.toHaveBeenCalled();
    // A busca é por teste, sem janela de tempo (S-16 da bateria).
    const [{ where }] = prisma.subscriptionHistory.findFirst.mock.calls[0];
    expect(where).toEqual({
      subscriptionId: 's1',
      action: 'TRIAL_EXPIRING_NOTIFICATION',
    });
  });

  it('teste vencido sem notícia do Stripe expira, depois da folga do webhook', async () => {
    rowsFor({
      expiredTrials: [{ id: 's1', userId: 'u1', planType: 'PLUS', price: 30 }],
    });

    const result = await service.checkSubscriptions();

    const [{ where }] = prisma.subscription.findMany.mock.calls.find(
      ([args]) => args.where.status === 'TRIAL' && args.where.trialEndDate?.lt,
    );
    expect(where.trialEndDate.lt.getTime()).toBeLessThan(
      Date.now() - DAY + 1000,
    );

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'EXPIRED' },
    });
    expect(subscriptions.updateUserPlanCache).toHaveBeenCalledWith('u1');
    expect(result.trialsExpired).toBe(1);
  });

  it('lembra a renovação uma vez por ciclo', async () => {
    const endDate = new Date(Date.now() + 5 * DAY);
    rowsFor({
      renewals: [
        {
          id: 's1',
          userId: 'u1',
          planType: 'MENTOR',
          price: null,
          endDate,
          user: { email: 'a@x.com', firstName: 'Ana' },
        },
        { id: 's2', endDate: null, user: { email: 'b@x.com' } },
      ],
    });

    const result = await service.checkSubscriptions();

    expect(mail.sendRenewalReminderEmail).toHaveBeenCalledWith('a@x.com', {
      firstName: 'Ana',
      planType: 'MENTOR',
      renewalDate: endDate,
      amount: 0,
    });
    expect(result.renewalsReminder).toBe(1);
  });

  // A cancelada tem acesso até endDate; depois, o plano em cache precisa cair.
  it('expira ativa, atrasada e cancelada que passaram do fim', async () => {
    rowsFor({
      expired: [
        { id: 's1', userId: 'u1', planType: 'PLUS', status: 'ACTIVE' },
        { id: 's2', userId: 'u2', planType: 'PLUS', status: 'CANCELLED' },
      ],
    });

    const result = await service.checkSubscriptions();

    const [{ where }] = prisma.subscription.findMany.mock.calls.find(([args]) =>
      Array.isArray(args.where.status?.in),
    );
    expect(where.status.in).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELLED']);
    expect(result.subscriptionsExpired).toBe(2);
    expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 's2',
        reason: 'Fim do período pago de assinatura cancelada',
      }),
    });
  });

  it('atrasada sem pagamento no prazo: encerra no Stripe, aqui, e avisa', async () => {
    rowsFor({
      expired: [
        {
          id: 's1',
          userId: 'u1',
          planType: 'MENTOR',
          status: 'PAST_DUE',
          stripeSubscriptionId: 'sub_1',
          user: { email: 'a@x.com', firstName: 'Ana' },
        },
      ],
    });

    await service.checkSubscriptions();

    expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_1');
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'EXPIRED' },
    });
    expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: 'Cobrança recusada e não resolvida no prazo',
      }),
    });
    expect(mail.sendSubscriptionEndedEmail).toHaveBeenCalledWith('a@x.com', {
      firstName: 'Ana',
      planType: 'MENTOR',
    });
  });

  it('se o Stripe recusar o encerramento, a assinatura não muda aqui', async () => {
    rowsFor({
      expired: [
        {
          id: 's1',
          userId: 'u1',
          status: 'PAST_DUE',
          stripeSubscriptionId: 'sub_1',
          user: { email: 'a@x.com' },
        },
      ],
    });
    stripe.cancelSubscriptionNow.mockRejectedValue(new Error('stripe fora'));

    const result = await service.checkSubscriptions();

    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(result.errors).toContain('Expirar assinatura s1: stripe fora');
  });

  it('checkout abandonado há mais de dois dias expira', async () => {
    prisma.subscription.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.checkSubscriptions();

    const [{ where, data }] = prisma.subscription.updateMany.mock.calls[0];
    expect(where.status).toBe('PENDING');
    expect(where.createdAt.lt.getTime()).toBeLessThan(
      Date.now() - 2 * DAY + 1000,
    );
    expect(data).toEqual({ status: 'EXPIRED' });
    expect(result.checkoutsAbandoned).toBe(3);
  });

  it('erro numa assinatura não para as outras; tudo vai para `errors`', async () => {
    rowsFor({
      expiring: [
        { id: 's1', trialEndDate: new Date(), user: { email: 'a@x.com' } },
      ],
      expiredTrials: [{ id: 's2', userId: 'u2' }],
      renewals: [{ id: 's3', endDate: new Date(), user: { email: 'a@x.com' } }],
      expired: [{ id: 's4', userId: 'u4', status: 'ACTIVE' }],
    });
    mail.sendTrialExpiringEmail.mockRejectedValue(new Error('smtp'));
    mail.sendRenewalReminderEmail.mockRejectedValue(new Error('smtp'));
    prisma.subscription.update.mockRejectedValue(new Error('mongo'));
    prisma.subscription.updateMany.mockRejectedValue(new Error('mongo'));

    const result = await service.checkSubscriptions();

    expect(result.errors).toEqual([
      'Trial s1: smtp',
      'Expirar trial s2: mongo',
      'Lembrete de renovação s3: smtp',
      'Expirar assinatura s4: mongo',
      'Checkouts abandonados: mongo',
    ]);
  });
});
