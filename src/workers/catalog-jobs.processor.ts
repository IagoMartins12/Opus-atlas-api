import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  JOB_CATALOG_RUN,
  QUEUE_CATALOG,
} from '../common/queue/queue.constants';
import { JobEnvelope } from '../common/queue/job-contract';
import {
  CatalogJobPayload,
  CatalogJobsService,
} from '../admin/catalog/catalog-jobs.service';

type CatalogJob = Job<JobEnvelope<CatalogJobPayload>>;

/**
 * Consumidor das rotinas do acervo. **Concorrência 1**: as rotinas mexem nas
 * mesmas coleções, e o serviço também recusa disparar uma segunda enquanto há
 * uma em andamento. O progresso e o resultado ficam em `CatalogJobRun`.
 */
@Processor(QUEUE_CATALOG, { concurrency: 1 })
export class CatalogJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(CatalogJobsProcessor.name);

  constructor(private readonly jobs: CatalogJobsService) {
    super();
  }

  async process(job: CatalogJob): Promise<void> {
    if (job.name !== JOB_CATALOG_RUN) {
      throw new UnrecoverableError(
        `Job desconhecido na fila ${QUEUE_CATALOG}: ${job.name}`,
      );
    }
    await this.jobs.execute(job.data.payload.runId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: CatalogJob, error: Error): void {
    this.logger.error(
      `Rotina do acervo ${job.data?.payload?.runId ?? job.name} falhou: ${error.message}`,
    );
  }
}
