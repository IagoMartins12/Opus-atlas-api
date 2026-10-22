import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

/** Recomendações de peças (Plus): o motor e as rotas da obra e dos estudos. */
@Module({
  imports: [BillingModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
