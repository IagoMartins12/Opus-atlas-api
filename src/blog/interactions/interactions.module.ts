import { Module } from '@nestjs/common';
import { InteractionsController } from './interactions.controller';
import { InteractionsService } from './interactions.service';

@Module({
  controllers: [InteractionsController],
  providers: [InteractionsService],
})
export class InteractionsModule {}
