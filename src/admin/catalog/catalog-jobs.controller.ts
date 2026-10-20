import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogJobsService } from './catalog-jobs.service';
import { StartCatalogJobDto } from './dto/catalog-jobs.dto';

/** As rotinas do acervo no painel: rodar, acompanhar e parar. */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/catalog-jobs')
export class CatalogJobsController {
  constructor(private readonly jobs: CatalogJobsService) {}

  @Get()
  @ApiOperation({
    summary: 'As rotinas do acervo, com a última execução de cada',
  })
  @ApiOkResponse({ description: 'Rotinas, a execução em andamento e a última' })
  list() {
    return this.jobs.list();
  }

  @Get('runs/:runId')
  @ApiOperation({
    summary: 'Uma execução: progresso, resultado e log',
    description: 'É o que a tela pergunta enquanto a rotina roda.',
  })
  run(@Param('runId') runId: string) {
    return this.jobs.get(runId);
  }

  @Post('runs/:runId/stop')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'catalog.job.stop',
    entityType: 'catalogJobRun',
    entityIdParam: 'runId',
  })
  @ApiOperation({ summary: 'Pede para parar uma execução em andamento' })
  stop(@Param('runId') runId: string) {
    return this.jobs.stop(runId);
  }

  @Get(':job/runs')
  @ApiOperation({ summary: 'Histórico de execuções de uma rotina' })
  history(@Param('job') job: string) {
    return this.jobs.history(job);
  }

  @Post(':job/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audited({
    action: 'catalog.job.run',
    entityType: 'catalogJob',
    entityIdParam: 'job',
  })
  @ApiOperation({
    summary: 'Dispara uma rotina (simula, ou grava com `apply`)',
    description:
      'Enfileira para o worker e responde na hora com a execução. Uma por vez. Rotina que junta ou apaga registros exige `confirm: true` para gravar.',
  })
  start(
    @Param('job') job: string,
    @Body() dto: StartCatalogJobDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.jobs.start(
      job,
      {
        apply: dto.apply === true,
        confirm: dto.confirm === true,
        limit: dto.limit,
        pause: dto.pause,
      },
      user.sub,
    );
  }
}
