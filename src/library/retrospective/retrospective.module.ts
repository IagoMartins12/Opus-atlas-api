import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { BillingModule } from '../../billing/billing.module';
import { RecommendationsModule } from '../../catalog/recommendations/recommendations.module';
import { RetrospectiveController } from './retrospective.controller';
import { RetrospectiveService } from './retrospective.service';

/** A retrospectiva de estudo (Plus). */
@Module({
  imports: [BillingModule, AiModule, RecommendationsModule],
  controllers: [RetrospectiveController],
  providers: [RetrospectiveService],
})
export class RetrospectiveModule {}
