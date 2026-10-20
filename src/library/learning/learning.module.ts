import { Module } from '@nestjs/common';
import { WantToLearnController } from './want-to-learn.controller';
import { LearnedController } from './learned.controller';
import { LearningService } from './learning.service';
import { SchoolActivitiesService } from '../../portal/school-activities/school-activities.service';

@Module({
  controllers: [WantToLearnController, LearnedController],
  // A trilha escolar só grava no banco: sem estado, dá para instanciar aqui
  // sem importar o módulo inteiro do portal.
  providers: [LearningService, SchoolActivitiesService],
})
export class LearningModule {}
