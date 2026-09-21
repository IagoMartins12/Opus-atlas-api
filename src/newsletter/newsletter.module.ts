import { Module } from '@nestjs/common';
import { NewsletterController } from './newsletter.controller';
import { NewsletterIndexesService } from './newsletter-indexes.service';
import { NewsletterService } from './newsletter.service';

@Module({
  controllers: [NewsletterController],
  providers: [NewsletterService, NewsletterIndexesService],
  exports: [NewsletterService],
})
export class NewsletterModule {}
