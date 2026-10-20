import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScrapedEvent } from '../common/interfaces/scraped-event.interface';
import { JobStatusService } from '../common/queue/job-status.service';
import { QUEUE_SCRAPER } from '../common/queue/queue.constants';
import { ImportService } from './import/import.service';
import { isScraperId } from './scraper-registry';
import type { EventoDaRodada, ScraperRunResult } from './scraper-run.service';

/**
 * A prévia de uma rodada manual e a importação do que foi escolhido nela.
 *
 * A rodada pedida à mão só lê o site. Os eventos lidos ficam no resultado do
 * job (no Redis, por sete dias); importar lê de lá pelos índices — o
 * navegador escolhe **quais**, não manda o conteúdo do evento.
 */
@Injectable()
export class ScraperPreviewService {
  constructor(
    private readonly status: JobStatusService,
    private readonly importer: ImportService,
  ) {}

  private async prevista(jobId: string): Promise<ScraperRunResult> {
    const job = await this.status.resultadoCompleto(QUEUE_SCRAPER, jobId);

    if (!job) {
      throw new NotFoundException(
        'Rodada não encontrada — a prévia fica guardada por sete dias.',
      );
    }
    if (job.state !== 'completed') {
      throw new ConflictException('A rodada ainda não terminou.');
    }

    const result = job.result as ScraperRunResult | null;
    if (!result || result.modo !== 'previa' || !result.lidos) {
      throw new BadRequestException(
        'Esta rodada já importou sozinha (agendada); não há o que escolher.',
      );
    }
    if (!isScraperId(result.scraperId)) {
      throw new BadRequestException('Casa desconhecida nesta rodada.');
    }

    return result;
  }

  /**
   * A prévia conferida de novo contra a agenda: o que foi importado depois da
   * rodada (por esta tela ou por outra) aparece como "já está na agenda".
   */
  async previa(jobId: string) {
    const r = await this.prevista(jobId);
    const eventos: EventoDaRodada[] = await Promise.all(
      (r.lidos ?? []).map(async (e, indice) => {
        const existe = await this.importer.existente(e);
        const original = r.eventos.find((x) => x.indice === indice);
        return {
          ...(original ?? {
            indice,
            titulo: e.title,
            data: null,
            mensagem: '',
          }),
          indice,
          estado: existe ? ('ja-existia' as const) : ('novo' as const),
          mensagem: existe ? 'Já está na agenda' : 'Novo — ainda não importado',
          eventId: existe?.id ?? null,
        };
      }),
    );

    return {
      scraperId: r.scraperId,
      venueName: r.venueName,
      lidos: r.eventsFound,
      novos: eventos.filter((e) => e.estado === 'novo').length,
      eventos,
    };
  }

  /** Importa os escolhidos. Repetir um índice ou mandar um que já entrou não duplica. */
  async importar(jobId: string, indices: number[]) {
    const r = await this.prevista(jobId);
    const lidos = r.lidos ?? [];
    const escolhidos = [...new Set(indices)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < lidos.length)
      .sort((a, b) => a - b);

    if (escolhidos.length === 0) {
      throw new BadRequestException('Escolha ao menos um evento da prévia.');
    }

    const eventos: ScrapedEvent[] = escolhidos.map((i) => lidos[i]);
    const resultado = await this.importer.importEvents(r.scraperId, eventos);

    return {
      scraperId: r.scraperId,
      venueName: r.venueName,
      escolhidos: escolhidos.length,
      importados: resultado.imported,
      jaExistiam: resultado.duplicates,
      falharam: resultado.failed,
      eventos: resultado.details.map((d, k) => ({
        indice: escolhidos[k],
        titulo: d.title,
        estado:
          d.status === 'success'
            ? 'importado'
            : d.status === 'duplicate'
              ? 'ja-existia'
              : 'falhou',
        mensagem: d.message,
        eventId: d.eventId ?? d.existingId ?? null,
      })),
    };
  }
}
