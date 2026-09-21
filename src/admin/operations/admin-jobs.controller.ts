import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JobStatusService } from '../../common/queue/job-status.service';
import { QueueService } from '../../common/queue/queue.service';
import {
  isQueueName,
  QUEUE_NAMES,
  QueueName,
} from '../../common/queue/queue.constants';
import { ListFailuresQueryDto } from './dto/admin-jobs.dto';

/**
 * Observação da fila.
 *
 * Uma rota que responde `202 { jobId }` só é honesta se existir onde consultar
 * esse id. Sem isso o administrador tem um número que não serve para nada, e a
 * única forma de saber se o trabalho aconteceu é procurar o efeito dele no
 * banco — que é o que se estava tentando evitar.
 */
@ApiTags('admin-operations')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(
    private readonly status: JobStatusService,
    private readonly queue: QueueService,
  ) {}

  @Get('queues')
  @ApiOperation({
    summary: 'Saúde das filas',
    description:
      'Quantos jobs esperam, quantos falharam, e — o número que mais importa — ' +
      '**quantos workers estão conectados**. Zero worker com fila crescendo é o ' +
      'sintoma de um cluster subido só com a imagem `api`: as rotas respondem ' +
      '202, os jobs entram, e nada nunca é processado.',
  })
  @ApiOkResponse({ description: 'Uma linha por fila registrada' })
  async queues() {
    return { queues: await this.status.health() };
  }

  @Get(':queue/failures')
  @ApiOperation({
    summary: 'Últimas falhas de uma fila',
    description: 'Responde "o que quebrou" sem obrigar a abrir job por job.',
  })
  @ApiParam({ name: 'queue', enum: QUEUE_NAMES })
  @ApiOkResponse({ description: 'Falhas mais recentes primeiro' })
  async failures(
    @Param('queue') queue: string,
    @Query() query: ListFailuresQueryDto,
  ) {
    return {
      queue,
      failures: await this.status.failures(
        this.requireQueue(queue),
        query.limit ?? 20,
      ),
    };
  }

  @Get(':queue/schedules')
  @ApiOperation({
    summary: 'Agendamentos recorrentes de uma fila',
    description:
      'Lidos do Redis, não da memória do processo: sobrevivem a reinício e ' +
      'valem uma vez para o cluster inteiro.',
  })
  @ApiParam({ name: 'queue', enum: QUEUE_NAMES })
  @ApiOkResponse({ description: 'Agendamentos e próxima execução' })
  async schedules(@Param('queue') queue: string) {
    return {
      queue,
      schedules: await this.queue.listSchedules(this.requireQueue(queue)),
    };
  }

  @Get(':queue/:jobId')
  @ApiOperation({
    summary: 'Estado de um job',
    description:
      'O BullMQ é a fonte da verdade, sem tabela espelho: dois lugares que ' +
      'sabem o estado do job discordam exatamente quando o worker morre no ' +
      'meio, que é quando a resposta importa. O preço é a retenção — concluído ' +
      'some em 7 dias, falha em 30. A prova permanente de quem pediu o que fica ' +
      'no `AdminAuditLog`, que não expira.\n\n' +
      '**Para acompanhar em tempo real, não pergunte em laço:** conecte no ' +
      'namespace socket.io `/jobs` com `auth: { token }` (o mesmo access ' +
      'token), emita `watch` com `{ queue, jobId }` e escute `job.update`. A ' +
      'confirmação do `watch` já traz o estado atual. O socket avisa que o job ' +
      'terminou; o resultado continua sendo lido aqui.',
  })
  @ApiParam({ name: 'queue', enum: QUEUE_NAMES })
  @ApiOkResponse({ description: 'Estado, progresso e resultado' })
  @ApiNotFoundResponse({ description: 'Job inexistente ou já expirado' })
  async job(@Param('queue') queue: string, @Param('jobId') jobId: string) {
    const view = await this.status.describe(this.requireQueue(queue), jobId);

    if (!view) {
      throw new NotFoundException(
        'Job não encontrado — pode ter saído da janela de retenção',
      );
    }

    return view;
  }

  @Delete(':queue/:jobId')
  @Audited({ action: 'job.cancel', entityType: 'job', entityIdParam: 'jobId' })
  @ApiOperation({
    summary: 'Cancela um job ainda não iniciado',
    description:
      'Só o que está esperando ou agendado. Job em execução não é cancelável ' +
      'por fora — o processor precisa terminar ou falhar, e interrompê-lo no ' +
      'meio deixaria efeito pela metade.',
  })
  @ApiParam({ name: 'queue', enum: QUEUE_NAMES })
  @ApiOkResponse({ description: 'Removido da fila' })
  @ApiNotFoundResponse({ description: 'Job inexistente ou já em execução' })
  async cancel(@Param('queue') queue: string, @Param('jobId') jobId: string) {
    const removed = await this.queue.cancel(this.requireQueue(queue), jobId);

    if (!removed) {
      throw new NotFoundException(
        'Job não encontrado, já concluído, ou em execução',
      );
    }

    return { queue, jobId, cancelled: true };
  }

  private requireQueue(name: string): QueueName {
    if (!isQueueName(name)) {
      throw new BadRequestException(
        `Fila desconhecida: "${name}". Existem: ${QUEUE_NAMES.join(', ')}.`,
      );
    }

    return name;
  }
}
