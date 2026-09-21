import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
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
  };
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
    };
    service = new SubscriptionsCronService(
      prisma as unknown as PrismaService,
      subscriptions as unknown as SubscriptionsService,
      mail as unknown as MailService,
    );
  });

  it('avisa teste acabando, uma vez por dia, e registra', async () => {
    rowsFor({
      expiring: [
        {
          id: 's1',
          userId: 'u1',
          planType: 'PLUS',
          trialEndDate: new Date(Date.now() + 2 * DAY - 1000),
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
    });
    expect(result.trialsExpiring).toBe(1);
    expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'TRIAL_EXPIRING_NOTIFICATION' }),
    });
  });

  it('já avisado nas últimas 24 h não recebe de novo', async () => {
    rowsFor({
      expiring: [
        { id: 's1', trialEndDate: new Date(), user: { email: 'a@x.com' } },
      ],
    });
    prisma.subscriptionHistory.findFirst.mockResolvedValue({ id: 'h' });

    await service.checkSubscriptions();

    expect(mail.sendTrialExpiringEmail).not.toHaveBeenCalled();
  });

  it('teste vencido expira e o plano do usuário volta ao gratuito', async () => {
    rowsFor({
      expiredTrials: [{ id: 's1', userId: 'u1', planType: 'PLUS', price: 30 }],
    });

    const result = await service.checkSubscriptions();

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'EXPIRED' },
    });
    expect(subscriptions.updateUserPlanCache).toHaveBeenCalledWith('u1');
    expect(result.trialsExpired).toBe(1);
  });

  it('lembra a renovação uma vez por semana', async () => {
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
