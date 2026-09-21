import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  JOB_NEWSLETTER_BATCH,
  JOB_NEWSLETTER_PLAN,
  QUEUE_NEWSLETTER,
} from '../common/queue/queue.constants';
import { JobEnvelope } from '../common/queue/job-contract';
import { buildProgress } from '../common/queue/job-progress';
import {
  NewsletterBatchPayload,
  NewsletterDispatchService,
  NewsletterPlanPayload,
} from '../admin/newsletter/newsletter-dispatch.service';

type NewsletterJob = Job<
  JobEnvelope<NewsletterPlanPayload | NewsletterBatchPayload>
>;

/**
 * Consumidor da fila de newsletter.
 *
 * **Concorrência 1, de propósito.** Cada lote são cinquenta conexões SMTP em
 * sequência; dois lotes em paralelo dobram a taxa contra o mesmo servidor de
 * e-mail, que é exatamente o comportamento que faz um provedor limitar ou
 * bloquear o domínio. O caminho para enviar mais rápido é subir mais um
 * worker com uma cota de envio própria, não abrir mais linhas aqui.
 *
 * O processor é fino de propósito: ele traduz job em chamada de serviço e não
 * sabe nada sobre campanha. A lógica que precisa ser testada não deve depender
 * de haver um Redis por perto.
 */
@Processor(QUEUE_NEWSLETTER, { concurrency: 1 })
export class NewsletterProcessor extends WorkerHost {
  private readonly logger = new Logger(NewsletterProcessor.name);

  constructor(private readonly dispatch: NewsletterDispatchService) {
    super();
  }

  async process(job: NewsletterJob): Promise<unknown> {
    const { payload, requestedBy } = job.data;

    switch (job.name) {
      case JOB_NEWSLETTER_PLAN:
        return this.dispatch.plan(
          (payload as NewsletterPlanPayload).campaignId,
          requestedBy,
        );

      case JOB_NEWSLETTER_BATCH: {
        const batch = payload as NewsletterBatchPayload;
        const result = await this.dispatch.sendBatch(
          batch.campaignId,
          batch.subscriberIds,
        );

        await job
          .updateProgress(
            buildProgress(
              100,
              `${result.sent} enviados, ${result.failed} com erro`,
            ),
          )
          .catch(() => undefined);

        return result;
      }

      default:
        // `UnrecoverableError` encerra o job na hora. Sem isso, um nome de job
        // que este worker não conhece — versão antiga ainda na fila depois de
        // um deploy — gastaria as três tentativas para falhar do mesmo jeito.
        throw new UnrecoverableError(
          `Job desconhecido na fila ${QUEUE_NEWSLETTER}: ${job.name}`,
        );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: NewsletterJob, error: Error): void {
    this.logger.error(
      `Job ${job.name} (${job.id}) falhou na tentativa ${job.attemptsMade}: ${error.message}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: NewsletterJob): void {
    this.logger.log(`Job ${job.name} (${job.id}) concluído`);
  }
}
