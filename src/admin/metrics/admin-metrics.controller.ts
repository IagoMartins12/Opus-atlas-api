import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminMetricsService } from './admin-metrics.service';
import { InsightsQueryDto } from './dto/metrics-query.dto';

/**
 * Métricas e insights da plataforma.
 *
 * Substitui `admin/insights`, `admin/stats`, `admin/analytics` e
 * `admin/reports` — cerca de 4.500 linhas em que **35 chamadas a
 * `Math.random()`** produziam previsões, tendências e até a própria
 * `confidence` das previsões.
 *
 * Aqui todo insight carrega o que foi medido, sobre quantos registros, e o
 * mínimo de amostra para a leitura valer. Sem base, o insight se declara
 * `insufficient_data` em vez de afirmar. Nenhum número é estimado.
 */
@ApiTags('admin-metrics')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly service: AdminMetricsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Números de base da plataforma',
    description:
      'As contagens da mesma coleção vão numa passada só, com `$facet`. O ' +
      'legado disparava uma consulta por número.',
  })
  @ApiOkResponse({ description: 'Usuários, catálogo, portal e biblioteca' })
  async overview() {
    return this.service.overview();
  }

  @Get('insights')
  // Cada área cruza várias coleções; o teto evita que a tela dispare em série.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Insights acionáveis, ordenados pelo que exige atenção',
    description:
      'Cinco áreas: catálogo, aprendizado, audiência, ensino e monetização. ' +
      'Cada insight traz `measurement.sampleSize` e `minimumSample` — abaixo do ' +
      'mínimo a severidade vira `insufficient_data` e o valor vira nulo, em vez ' +
      'de virar veredito. `evidence` traz os casos concretos, para conferir em ' +
      'vez de acreditar.',
  })
  @ApiOkResponse({
    description: 'Insights com severidade, medida, amostra, ação e evidência',
  })
  async insights(@Query() query: InsightsQueryDto) {
    return this.service.insights(query.areas);
  }
}
