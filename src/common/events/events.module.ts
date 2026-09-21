import { Global, Module } from '@nestjs/common';
import { ActivityTracker } from './activity-tracker.service';

/**
 * Global porque qualquer módulo de domínio pode registrar atividade, e o
 * `ActivityTracker` não carrega estado próprio.
 */
@Global()
@Module({
  providers: [ActivityTracker],
  exports: [ActivityTracker],
})
export class AppEventsModule {}
