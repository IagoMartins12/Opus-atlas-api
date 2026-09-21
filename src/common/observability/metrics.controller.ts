import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { Public } from '../decorators/api-key.decorator';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de scraping do Prometheus.
 *
 * Marcado como `@Public()` para escapar do `JwtAuthGuard` global (o Prometheus
 * não tem sessão de usuário) e protegido pelo `ApiKeyGuard` — expor métricas
 * abertas revela volume de tráfego, rotas internas e nomes de módulo.
 */
@ApiExcludeController()
@Controller('metrics')
@Public()
@UseGuards(ApiKeyGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    return this.metricsService.metrics();
  }
}
