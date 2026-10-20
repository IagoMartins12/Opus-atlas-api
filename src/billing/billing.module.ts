import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { CronController } from './cron.controller';
import { WebhookController } from './webhook.controller';
import { CouponsService } from './services/coupons.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { PlanPricingService } from './services/plan-pricing.service';
import { StripeCatalogService } from './services/stripe-catalog.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionsCronService } from './services/subscriptions-cron.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { WebhookService } from './services/webhook.service';

@Module({
  controllers: [BillingController, WebhookController, CronController],
  providers: [
    PlanPricingService,
    CouponsService,
    StripeService,
    StripeCatalogService,
    InvoicesService,
    SubscriptionsService,
    PaymentsService,
    WebhookService,
    SubscriptionsCronService,
  ],
  exports: [SubscriptionsService, StripeService, StripeCatalogService],
})
export class BillingModule {}
