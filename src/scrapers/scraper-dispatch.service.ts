import { BadRequestException, Injectable } from '@nestjs/common';
import { QueueService } from '../common/queue/queue.service';
import {
  JOB_SCRAPER_RUN,
  QUEUE_SCRAPER,
} from '../common/queue/queue.constants';
import { buildIdempotencyKey } from '../common/queue/job-contract';
import { SCRAPER_IDS, ScraperId, ScraperRegistry } from './scraper-registry';

/** Fuso dos agendamentos, o mesmo da manutenção. */
export const SCRAPER_TIMEZONE = 'America/Sao_Paulo';

const CRON_FIELDS = 5;

export interface ScraperJobPayload {
  scraperId: ScraperId;
}

@Injectable()
export class ScraperDispatchService {
  constructor(
    private readonly registry: ScraperRegistry,
    private readonly queue: QueueService,
  ) {}

  /**
   * Enfileira uma rodada.
   *
   * A chave inclui o minuto: clicar duas vezes em "raspar OSESP" produz uma
   * rodada, não duas. Passado o minuto, uma rodada nova é uma rodada nova — o
   * que permite tentar de novo depois de uma falha sem esperar o dia seguinte.
   */
  async enqueue(scraperId: ScraperId, requestedBy: string | null) {
    this.registry.requireId(scraperId);

    const minute = new Date().toISOString().slice(0, 16);

    return this.queue.enqueue<ScraperJobPayload>({
      queue: QUEUE_SCRAPER,
      job: JOB_SCRAPER_RUN,
      idempotencyKey: buildIdempotencyKey('scraper', scraperId, minute),
      payload: { scraperId },
      requestedBy,
    });
  }

  /**
   * Enfileira todas as casas.
   *
   * **Enfileira, não executa.** O `scrape-all` anterior disparava sete
   * `setImmediate` no processo HTTP, cada um abrindo seu próprio scraper ao
   * mesmo tempo. Aqui os sete entram na fila e o worker os consome um a um,
   * porque sete navegadores simultâneos é o caminho curto para estourar a
   * memória do contêiner — e para o site da casa nos bloquear.
   */
  async enqueueAll(requestedBy: string | null) {
    const jobs = [];

    for (const scraperId of SCRAPER_IDS) {
      jobs.push(await this.enqueue(scraperId, requestedBy));
    }

    return { queued: jobs.length, jobs };
  }

  async listSchedules() {
    const schedules = await this.queue.listSchedules(QUEUE_SCRAPER);

    return {
      schedules: schedules.map((schedule) => ({
        ...schedule,
        scraperId: schedule.schedulerId.replace(/^scraper:/, ''),
      })),
      timezone: SCRAPER_TIMEZONE,
    };
  }

  /**
   * Agenda a rodada recorrente de uma casa.
   *
   * Um scraper, um agendamento: salvar de novo substitui. Vive no Redis, então
   * sobrevive a reinício e vale uma vez para o cluster — com o agendamento em
   * memória, N réplicas raspariam a mesma casa N vezes por noite, o que é o
   * tipo de coisa que faz um site nos bloquear.
   */
  async setSchedule(input: {
    scraperId: ScraperId;
    cron: string;
    requestedBy: string | null;
  }) {
    this.registry.requireId(input.scraperId);
    this.assertCron(input.cron);

    await this.queue.upsertSchedule<ScraperJobPayload>({
      queue: QUEUE_SCRAPER,
      schedulerId: this.schedulerId(input.scraperId),
      cron: input.cron,
      timezone: SCRAPER_TIMEZONE,
      job: JOB_SCRAPER_RUN,
      payload: { scraperId: input.scraperId },
      requestedBy: input.requestedBy,
    });

    const saved = (await this.queue.listSchedules(QUEUE_SCRAPER)).find(
      (schedule) => schedule.schedulerId === this.schedulerId(input.scraperId),
    );

    return {
      scraperId: input.scraperId,
      cron: input.cron,
      timezone: SCRAPER_TIMEZONE,
      nextRunAt: saved?.nextRunAt ?? null,
    };
  }

  async removeSchedule(scraperId: ScraperId): Promise<boolean> {
    return this.queue.removeSchedule(
      QUEUE_SCRAPER,
      this.schedulerId(scraperId),
    );
  }

  private schedulerId(scraperId: ScraperId): string {
    return `scraper:${scraperId}`;
  }

  private assertCron(cron: string): void {
    if (cron.trim().split(/\s+/).length !== CRON_FIELDS) {
      throw new BadRequestException(
        `Expressão cron precisa de ${CRON_FIELDS} campos (minuto hora dia mês dia-da-semana). Recebido: "${cron}".`,
      );
    }
  }
}
