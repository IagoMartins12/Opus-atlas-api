import { Module } from '@nestjs/common';
import { AchievementsController } from './achievements.controller';
import { AchievementsListener } from './achievements.listener';
import { AchievementsService } from './achievements.service';
import { AchievementStatsService } from './achievement-stats.service';

/**
 * Sistema de conquistas.
 *
 * O `AchievementsListener` é o que fecha o ciclo automático: ações do usuário
 * em outros módulos emitem `activity.tracked`, e a avaliação acontece sem que
 * cada módulo precise conhecer as conquistas.
 */
@Module({
  controllers: [AchievementsController],
  providers: [
    AchievementsService,
    AchievementStatsService,
    AchievementsListener,
  ],
  exports: [AchievementsService],
})
export class AchievementsModule {}
