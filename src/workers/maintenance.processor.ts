import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  JOB_MAINTENANCE_RUN,
  QUEUE_MAINTENANCE,
} from '../common/queue/queue.constants';
import { JobEnvelope } from '../common/queue/job-contract';
import { MaintenanceJobPayload } from '../admin/maintenance/admin-maintenance.service';
import { MaintenanceTasksService } from '../admin/maintenance/maintenance-tasks.service';
import { isMaintenanceTaskId } from '../admin/maintenance/maintenance-catalog';

type MaintenanceJob = Job<JobEnvelope<MaintenanceJobPayload>>;

/**
 * Consumidor da fila de manutenção.
 *
 * **Concorrência 1.** Duas limpezas pesadas em paralelo disputam o mesmo banco,
 * e a varredura de órfãos já pagina sobre coleções grandes. Serializar aqui é o
 * equivalente ao `Set` de "tarefas rodando" que o legado mantinha em memória —
 * com a diferença de valer para o cluster inteiro, e não por processo.
 */
@Processor(QUEUE_MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly tasks: MaintenanceTasksService) {
    super();
  }

  async process(job: MaintenanceJob): Promise<unknown> {
    if (job.name !== JOB_MAINTENANCE_RUN) {
      throw new UnrecoverableError(
        `Job desconhecido na fila ${QUEUE_MAINTENANCE}: ${job.name}`,
      );
    }

    const { taskId, dryRun, retentionDays } = job.data.payload;

    // A carga vem do Redis, onde pode ter sido gravada por uma versão anterior
    // do código. Uma tarefa que não existe mais não é erro para tentar de novo.
    if (!isMaintenanceTaskId(taskId)) {
      throw new UnrecoverableError(
        `Tarefa de manutenção desconhecida: ${String(taskId)}`,
      );
    }

    return this.tasks.run(taskId, { dryRun, retentionDays });
  }

  @OnWorkerEvent('failed')
  onFailed(job: MaintenanceJob, error: Error): void {
    this.logger.error(
      `Manutenção ${job.data?.payload?.taskId ?? job.name} (${job.id}) falhou na tentativa ${job.attemptsMade}: ${error.message}`,
    );
  }
}
