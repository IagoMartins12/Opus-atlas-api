import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { SentryService } from './sentry.service';

/**
 * Camada transversal de observabilidade (seção 3.9 da SPEC): métricas
 * Prometheus e error tracking.
 *
 * É `@Global()` porque `MetricsService` é consumido pelo `LoggingInterceptor`
 * e por services de cache em qualquer módulo, e `SentryService` pelo filtro
 * global de exceções — reimportar em cada módulo seria ruído puro.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, SentryService],
  exports: [MetricsService, SentryService],
})
export class ObservabilityModule {}
