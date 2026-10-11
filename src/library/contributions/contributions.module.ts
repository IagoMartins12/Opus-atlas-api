import { Module } from '@nestjs/common';
import { PortalModule } from '../../portal/portal.module';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';

@Module({
  imports: [PortalModule],
  controllers: [ContributionsController],
  providers: [ContributionsService],
  exports: [ContributionsService],
})
export class ContributionsModule {}
