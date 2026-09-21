import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  JOB_SCRAPER_RUN,
  QUEUE_SCRAPER,
} from '../common/queue/queue.constants';
import { JobEnvelope } from '../common/queue/job-contract';
import { reportProgress } from '../common/queue/job-progress';
import { ScraperJobPayload } from '../scrapers/scraper-dispatch.service';
import { ScraperRunService } from '../scrapers/scraper-run.service';
import { isScraperId } from '../scrapers/scraper-registry';

type ScraperJob = Job<JobEnvelope<ScraperJobPayload>>;

/**
 * Consumidor da fila de scraping.
 *
 * **É este processor que finalmente tira o scraping do processo HTTP.** O alvo
 * `worker` do Dockerfile existe desde a Etapa 0 e carrega o Chromium; até aqui
 * ele rodava o mesmo processo da API, e uma varredura pesada degradava o
 * tráfego de usuário. Com `QUEUE_ROLE=worker`, quem raspa não atende
 * requisição.
 *
 * **Concorrência 1.** Cada rodada abre um navegador e faz dezenas de
 * requisições a um site de terceiro. Sete em paralelo — que é o que o
 * `scrape-all` anterior fazia — estouram a memória do contêiner e são o
 * caminho curto para o site nos bloquear.
 */
@Processor(QUEUE_SCRAPER, { concurrency: 1 })
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(private readonly runner: ScraperRunService) {
    super();
  }

  async process(job: ScraperJob): Promise<unknown> {
    if (job.name !== JOB_SCRAPER_RUN) {
      throw new UnrecoverableError(
        `Job desconhecido na fila ${QUEUE_SCRAPER}: ${job.name}`,
      );
    }

    const { scraperId } = job.data.payload;

    // A carga vem do Redis e pode ter sido gravada por uma versão anterior do
    // código. Uma casa que saiu do catálogo não é erro para tentar de novo.
    if (!isScraperId(scraperId)) {
      throw new UnrecoverableError(
        `Scraper desconhecido: ${String(scraperId)}`,
      );
    }

    // A frase vai junto do número. Antes ela ia só para `job.log`, que rota
    // nenhuma lê: quem acompanhava via `80` sem saber 80 do quê.
    return this.runner.run(scraperId, (percent, message) => {
      reportProgress(job, percent, message);
      void job.log(`${percent}% — ${message}`).catch(() => undefined);
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: ScraperJob, error: Error): void {
    this.logger.error(
      `Scraping de ${job.data?.payload?.scraperId ?? job.name} (${job.id}) ` +
        `falhou na tentativa ${job.attemptsMade}: ${error.message}`,
    );
  }
}
