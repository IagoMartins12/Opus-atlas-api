import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { JOB_IMSLP_SCORES, QUEUE_IMSLP } from '../common/queue/queue.constants';
import { JobEnvelope } from '../common/queue/job-contract';
import {
  ImslpScoresJobPayload,
  ImslpScoresService,
} from '../catalog/works/imslp-scores.service';

type ImslpJob = Job<JobEnvelope<ImslpScoresJobPayload>>;

/**
 * Consumidor da fila do IMSLP: tira a leitura das partituras da requisição da
 * página da obra (ver `ImslpScoresService`).
 *
 * **O limitador é da fila, não do processo.** `limiter` no BullMQ vale somando
 * todos os workers ligados à fila: com duas réplicas de worker, continua sendo
 * no máximo um pedido ao IMSLP a cada 1,5 s — ~40 por minuto, o ritmo de uma
 * pessoa navegando. A concorrência 2 só deixa um job gravar no banco enquanto
 * o próximo espera a vez do limitador.
 *
 * Sem `TaskRunsService.rastrear`: são milhares de leituras curtas por dia, e o
 * histórico de execuções é para tarefa de operação, não para cada obra.
 */
@Processor(QUEUE_IMSLP, {
  concurrency: 2,
  limiter: { max: 1, duration: 1_500 },
})
export class ImslpScoresProcessor extends WorkerHost {
  private readonly logger = new Logger(ImslpScoresProcessor.name);

  constructor(private readonly imslp: ImslpScoresService) {
    super();
  }

  async process(job: ImslpJob): Promise<{ stored: number }> {
    if (job.name !== JOB_IMSLP_SCORES) {
      throw new UnrecoverableError(
        `Job desconhecido na fila ${QUEUE_IMSLP}: ${job.name}`,
      );
    }

    const stored = await this.imslp.scrape(job.data.payload.workId);
    if (stored > 0) {
      this.logger.debug(
        `Obra ${job.data.payload.workId}: ${stored} partitura(s)`,
      );
    }
    return { stored };
  }
}
