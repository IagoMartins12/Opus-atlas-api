import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [NewsletterModule, BillingModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
