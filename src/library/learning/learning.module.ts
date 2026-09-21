import { Module } from '@nestjs/common';
import { WantToLearnController } from './want-to-learn.controller';
import { LearnedController } from './learned.controller';
import { LearningService } from './learning.service';

@Module({
  controllers: [WantToLearnController, LearnedController],
  providers: [LearningService],
})
export class LearningModule {}
