import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { SubscriptionsService } from './subscriptions.service';

export interface CronCheckResult {
  trialsExpiring: number;
  trialsExpired: number;
  renewalsReminder: number;
  subscriptionsExpired: number;
  checkoutsAbandoned: number;
  errors: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sessão de checkout do Stripe expira em 24 h; depois disso não há como pagar. */
const ABANDONED_CHECKOUT_MS = 2 * DAY_MS;

/**
 * Job de manutenção diária de assinaturas — portado de
 * `cron/check-subscriptions/route.ts`. Chamado por um scheduler externo
 * (mesmo modelo do legado, ex. Vercel Cron / cron-job.org), protegido por
 * `ApiKeyGuard` no controller.
 */
@Injectable()
export class SubscriptionsCronService {
  private readonly logger = new Logger(SubscriptionsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly mailService: MailService,
  ) {}

  async checkSubscriptions(): Promise<CronCheckResult> {
    const now = new Date();
    const result: CronCheckResult = {
      trialsExpiring: 0,
      trialsExpired: 0,
      renewalsReminder: 0,
      subscriptionsExpired: 0,
      checkoutsAbandoned: 0,
      errors: [],
    };

    await this.notifyTrialsExpiringSoon(now, result);
    await this.expireTrials(now, result);
    await this.remindUpcomingRenewals(now, result);
    await this.expireSubscriptions(now, result);
    await this.expireAbandonedCheckouts(now, result);

    this.logger.log(`Cron de assinaturas concluído: ${JSON.stringify(result)}`);
    return result;
  }

  private async notifyTrialsExpiringSoon(
    now: Date,
    result: CronCheckResult,
  ): Promise<void> {
    const threeDaysFromNow = new Date(now.getTime() + 3 * DAY_MS);

    const trials = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndDate: { gte: now, lte: threeDaysFromNow },
      },
      include: { user: true },
    });

    for (const subscription of trials) {
      try {
        const alreadyNotified = await this.prisma.subscriptionHistory.findFirst(
          {
            where: {
              subscriptionId: subscription.id,
              action: 'TRIAL_EXPIRING_NOTIFICATION',
              createdAt: { gte: new Date(now.getTime() - DAY_MS) },
            },
          },
        );

        if (alreadyNotified || !subscription.user.email) {
          continue;
        }

        const daysRemaining = Math.ceil(
          (subscription.trialEndDate!.getTime() - now.getTime()) / DAY_MS,
        );

        await this.mailService.sendTrialExpiringEmail(subscription.user.email, {
          firstName: subscription.user.firstName ?? 'Usuário',
          planType: subscription.planType,
          daysRemaining,
        });

        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            action: 'TRIAL_EXPIRING_NOTIFICATION',
            fromPlan: subscription.planType,
            toPlan: subscription.planType,
            reason: `E-mail enviado: trial expira em ${daysRemaining} dia(s)`,
          },
        });

        result.trialsExpiring++;
      } catch (error) {
        result.errors.push(
          `Trial ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async expireTrials(
    now: Date,
    result: CronCheckResult,
  ): Promise<void> {
    const expiredTrials = await this.prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndDate: { lt: now } },
    });

    for (const subscription of expiredTrials) {
      try {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });

        await this.subscriptionsService.updateUserPlanCache(
          subscription.userId,
        );

        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            action: 'EXPIRED',
            fromPlan: subscription.planType,
            toPlan: 'FREE',
            fromPrice: subscription.price,
            toPrice: 0,
            reason: 'Trial expirado',
          },
        });

        result.trialsExpired++;
      } catch (error) {
        result.errors.push(
          `Expirar trial ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async remindUpcomingRenewals(
    now: Date,
    result: CronCheckResult,
  ): Promise<void> {
    const sevenDaysFromNow = new Date(now.getTime() + 7 * DAY_MS);

    const renewals = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        autoRenew: true,
        endDate: { gte: now, lte: sevenDaysFromNow },
      },
      include: { user: true },
    });

    for (const subscription of renewals) {
      try {
        const alreadyReminded = await this.prisma.subscriptionHistory.findFirst(
          {
            where: {
              subscriptionId: subscription.id,
              action: 'RENEWAL_REMINDER_SENT',
              createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
            },
          },
        );

        if (
          alreadyReminded ||
          !subscription.endDate ||
          !subscription.user.email
        ) {
          continue;
        }

        await this.mailService.sendRenewalReminderEmail(
          subscription.user.email,
          {
            firstName: subscription.user.firstName ?? 'Usuário',
            planType: subscription.planType,
            renewalDate: subscription.endDate,
            amount: subscription.price ?? 0,
          },
        );

        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            action: 'RENEWAL_REMINDER_SENT',
            fromPlan: subscription.planType,
            toPlan: subscription.planType,
            reason: 'Lembrete de renovação enviado',
          },
        });

        result.renewalsReminder++;
      } catch (error) {
        result.errors.push(
          `Lembrete de renovação ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async expireSubscriptions(
    now: Date,
    result: CronCheckResult,
  ): Promise<void> {
    // Cancelada entra também: o acesso dela vale até `endDate`, e depois o
    // plano em cache do usuário precisa voltar para o gratuito.
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLED'] },
        endDate: { lt: now },
      },
    });

    for (const subscription of expired) {
      try {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });

        await this.subscriptionsService.updateUserPlanCache(
          subscription.userId,
        );

        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            action: 'EXPIRED',
            fromPlan: subscription.planType,
            toPlan: 'FREE',
            fromPrice: subscription.price,
            toPrice: 0,
            reason:
              subscription.status === 'CANCELLED'
                ? 'Fim do período pago de assinatura cancelada'
                : 'Assinatura expirada',
          },
        });

        result.subscriptionsExpired++;
      } catch (error) {
        result.errors.push(
          `Expirar assinatura ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Checkout aberto e nunca pago (`PENDING`) vira `EXPIRED`. Não dava acesso a
   * nada, mas ficava parecendo uma assinatura em andamento no histórico.
   */
  private async expireAbandonedCheckouts(
    now: Date,
    result: CronCheckResult,
  ): Promise<void> {
    try {
      const { count } = await this.prisma.subscription.updateMany({
        where: {
          status: 'PENDING',
          createdAt: { lt: new Date(now.getTime() - ABANDONED_CHECKOUT_MS) },
        },
        data: { status: 'EXPIRED' },
      });
      result.checkoutsAbandoned = count;
    } catch (error) {
      result.errors.push(`Checkouts abandonados: ${(error as Error).message}`);
    }
  }
}
