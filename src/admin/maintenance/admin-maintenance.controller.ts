import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminMaintenanceService } from './admin-maintenance.service';
import { SystemHealthService } from './system-health.service';
import {
  isMaintenanceTaskId,
  MAINTENANCE_TASK_IDS,
  MaintenanceTaskId,
} from './maintenance-catalog';
import {
  DeleteOrphansDto,
  DeleteTaskRunsDto,
  ListOrphansQueryDto,
  ListMaintenanceFailuresDto,
  ListTaskRunsQueryDto,
  RunMaintenanceTaskDto,
  SetMaintenanceScheduleDto,
} from './dto/admin-maintenance.dto';
import { TaskRunsService } from '../../common/queue/task-runs.service';
import { OrphanFilesService } from './orphan-files.service';

/**
 * Manutenção da plataforma.
 *
 * **Nada aqui roda dentro da requisição.** O legado executava a tarefa em
 * linha (`await executeMaintenanceTask(taskId)`) e o backup completo por
 * `spawn('npm run backup')` com timeout de **30 minutos** — meia hora com a
 * conexão HTTP aberta, para um trabalho que o cliente não precisa esperar.
 * Aqui toda execução responde **202 com um id de job**, consultável em
 * `GET /admin/jobs/maintenance/:jobId`.
 */
@ApiTags('admin-maintenance')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/maintenance')
export class AdminMaintenanceController {
  constructor(
    private readonly maintenance: AdminMaintenanceService,
    private readonly health: SystemHealthService,
    private readonly runs: TaskRunsService,
    private readonly orphans: OrphanFilesService,
  ) {}

  @Get('orphans')
  @ApiOperation({
    summary: 'Arquivos órfãos, um a um',
    description:
      'A imagem, de onde era (e o nome do registro removido, quando a ' +
      'remoção passou pela auditoria), quem enviou, quando e quanto pesa. ' +
      '`tipo=sem-dono` lista os que não declaram dono — indeterminados, não ' +
      'órfãos de certeza. Sem datas, todos.',
  })
  @ApiOkResponse({ description: 'Órfãos paginados, com o resumo' })
  async listOrphans(@Query() query: ListOrphansQueryDto) {
    return this.orphans.listar(
      { de: query.de, ate: query.ate, tipo: query.tipo },
      query.page ?? 1,
      query.limit ?? 40,
    );
  }

  @Post('orphans/delete')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'storage.orphan.delete', entityType: 'storedAsset' })
  @ApiOperation({
    summary: 'Remove arquivos órfãos',
    description:
      'Confere de novo cada arquivo antes de apagar (o dono pode ter voltado). ' +
      'Apaga do armazenamento e deixa o registro como removido. Até 200 por vez.',
  })
  @ApiOkResponse({ description: 'Quantos saíram e quais foram recusados' })
  async deleteOrphans(@Body() dto: DeleteOrphansDto) {
    return this.orphans.remover(dto.ids);
  }

  @Get('runs')
  @ApiOperation({
    summary: 'Histórico de execuções das tarefas',
    description:
      'Manutenção, varreduras do portal, publicação de artigos e rodadas de ' +
      'scraper: quem disparou (o agendamento ou uma pessoa), quanto levou, o ' +
      'que mudou e uma amostra do que foi afetado. As varreduras de minuto ' +
      'só entram quando fizeram algo.',
  })
  @ApiOkResponse({ description: 'Execuções paginadas, da mais recente' })
  async listRuns(@Query() query: ListTaskRunsQueryDto) {
    return this.runs.listar(query, query.page ?? 1, query.limit ?? 30);
  }

  @Get('runs/summary')
  @ApiOperation({
    summary: 'Por tarefa: quantas vezes rodou, a última, falhas',
  })
  @ApiOkResponse({ description: 'Uma linha por tarefa que já rodou' })
  async runsSummary() {
    return { tarefas: await this.runs.resumo() };
  }

  @Post('runs/delete')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'task-run.delete', entityType: 'taskRun' })
  @ApiOperation({
    summary: 'Apaga execuções do histórico',
    description:
      'As escolhidas (`ids`) ou todas antes de `before` (de uma tarefa, com ' +
      '`task`). Sem nenhum dos dois, não apaga nada.',
  })
  @ApiOkResponse({ description: 'Quantas foram apagadas' })
  async deleteRuns(@Body() dto: DeleteTaskRunsDto) {
    if (!dto.ids?.length && !dto.before) {
      throw new BadRequestException(
        'Escolha as execuções ou uma data para apagar as anteriores.',
      );
    }
    return this.runs.apagar(dto);
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'Catálogo de tarefas de manutenção',
    description:
      'Lista fechada, definida em código, com o agendamento vivo de cada uma. ' +
      'O legado guardava este catálogo num array mutável de módulo, que uma ' +
      'rota atualizava com `Object.assign(task, body)` — o corpo cru da ' +
      'requisição escrito sobre o objeto compartilhado, inclusive sobre o ' +
      'campo que decide qual código roda.',
  })
  @ApiOkResponse({ description: 'Tarefas e seus agendamentos' })
  async tasks() {
    return this.maintenance.listTasks();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Saúde do sistema, medida',
    description:
      'Cada número vem de `dbStats` ou de contagem real. O painel do legado ' +
      'era inventado: 100 GB de disco "simulado", 15 coleções fixas, ' +
      '`indexHealth: 95` fixo, e a lista de coleções para backup devolvia ' +
      '`Math.random()` como estimativa de registros.',
  })
  @ApiOkResponse({ description: 'Banco, índices de busca e filas' })
  async systemHealth() {
    return this.health.snapshot();
  }

  @Get('failures')
  @ApiOperation({ summary: 'Últimas falhas da fila de manutenção' })
  @ApiOkResponse({ description: 'Falhas mais recentes primeiro' })
  async failures(@Query() query: ListMaintenanceFailuresDto) {
    return this.maintenance.recentFailures(query.limit ?? 20);
  }

  @Post('tasks/:taskId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'maintenance.task.run',
    entityType: 'maintenanceTask',
    entityIdParam: 'taskId',
  })
  @ApiOperation({
    summary: 'Enfileira uma tarefa de manutenção',
    description:
      'Responde 202 com o id do job. **Tarefa destrutiva sem `confirm: true` ' +
      'roda em simulação** — conta o que seria removido e não remove nada.',
  })
  @ApiParam({ name: 'taskId', enum: MAINTENANCE_TASK_IDS })
  @ApiAcceptedResponse({ description: 'Tarefa enfileirada' })
  @ApiBadRequestResponse({
    description: 'Tarefa desconhecida',
    type: ErrorResponseDto,
  })
  async run(
    @Param('taskId') taskId: string,
    @Body() dto: RunMaintenanceTaskDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.maintenance.runTask({
      taskId: this.requireTask(taskId),
      confirm: dto.confirm ?? false,
      retentionDays: dto.retentionDays,
      requestedBy: user.sub,
    });
  }

  @Get('schedules')
  @ApiOperation({
    summary: 'Agendamentos vivos',
    description:
      'Lidos do Redis, não da memória do processo. Sobrevivem a reinício e ' +
      'valem uma vez para o cluster inteiro — no legado cada réplica ' +
      'registrava o seu, e o backup diário rodava uma vez por instância.',
  })
  @ApiOkResponse({ description: 'Agendamentos e próxima execução' })
  async schedules() {
    return this.maintenance.listSchedules();
  }

  @Put('schedules/:taskId')
  @Audited({
    action: 'maintenance.schedule.set',
    entityType: 'maintenanceTask',
    entityIdParam: 'taskId',
  })
  @ApiOperation({
    summary: 'Cria ou substitui o agendamento de uma tarefa',
    description:
      'Uma tarefa, um agendamento: salvar de novo substitui. O legado ' +
      'empilhava (`BACKUP_SCHEDULES.push`), e cada chamada registrava mais um ' +
      'cron no processo — dois agendamentos idênticos rodavam lado a lado.',
  })
  @ApiParam({ name: 'taskId', enum: MAINTENANCE_TASK_IDS })
  @ApiOkResponse({ description: 'Agendamento salvo, com a próxima execução' })
  @ApiBadRequestResponse({
    description: 'Cron inválido, ou tarefa destrutiva sem `confirm`',
    type: ErrorResponseDto,
  })
  async setSchedule(
    @Param('taskId') taskId: string,
    @Body() dto: SetMaintenanceScheduleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.maintenance.setSchedule({
      taskId: this.requireTask(taskId),
      cron: dto.cron,
      confirm: dto.confirm ?? false,
      retentionDays: dto.retentionDays,
      requestedBy: user.sub,
    });
  }

  @Delete('schedules/:taskId')
  @Audited({
    action: 'maintenance.schedule.remove',
    entityType: 'maintenanceTask',
    entityIdParam: 'taskId',
  })
  @ApiOperation({
    summary: 'Remove um agendamento',
    description:
      'E de fato o interrompe. No legado, apagar removia a linha do array e ' +
      'nunca parava o cron: a tarefa seguia rodando para sempre, sem nada que ' +
      'a descrevesse.',
  })
  @ApiParam({ name: 'taskId', enum: MAINTENANCE_TASK_IDS })
  @ApiOkResponse({ description: 'Agendamento removido' })
  @ApiNotFoundResponse({
    description: 'Não havia agendamento para esta tarefa',
    type: ErrorResponseDto,
  })
  async removeSchedule(@Param('taskId') taskId: string) {
    const removed = await this.maintenance.removeSchedule(
      this.requireTask(taskId),
    );

    if (!removed) {
      throw new NotFoundException('Não há agendamento para esta tarefa');
    }

    return { taskId, removed: true };
  }

  private requireTask(taskId: string): MaintenanceTaskId {
    if (!isMaintenanceTaskId(taskId)) {
      throw new BadRequestException(
        `Tarefa desconhecida: "${taskId}". Existem: ${MAINTENANCE_TASK_IDS.join(', ')}.`,
      );
    }

    return taskId;
  }
}
