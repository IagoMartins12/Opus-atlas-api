import { Module } from '@nestjs/common';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [NewsletterModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
