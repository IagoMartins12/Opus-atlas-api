import { Module } from '@nestjs/common';
import { ComposersModule } from '../../catalog/composers/composers.module';
import { PortalModule } from '../../portal/portal.module';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';

@Module({
  imports: [PortalModule, ComposersModule],
  controllers: [ContributionsController],
  providers: [ContributionsService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
