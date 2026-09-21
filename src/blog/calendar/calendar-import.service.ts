import { BadRequestException, Injectable } from '@nestjs/common';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportService } from '../../scrapers/import/import.service';
import { ScraperRegistry } from '../../scrapers/scraper-registry';
import { urlField } from '../shared/url-field';
import { ScrapedEventDto } from './dto/calendar.dto';

/**
 * O fluxo "buscar eventos" do painel: conferir duplicatas e importar os
 * escolhidos.
 *
 * **No legado esse fluxo nunca funcionou.** O modal começava chamando
 * `/api/blog/calendar/scapers/run` — com o erro de digitação —, uma rota que
 * não existe: 404 no primeiro passo. Na API, rodar o scraper é
 * `POST /scrapers/:scraperId/run`, na fila, e ele já importa sozinho. Estas
 * duas rotas servem a quem quiser escolher à mão o que entra.
 */
@Injectable()
export class CalendarImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importer: ImportService,
    private readonly registry: ScraperRegistry,
  ) {}

  /**
   * Marca quais eventos raspados já estão no calendário.
   *
   * **A rota do legado não tinha autenticação nenhuma** — qualquer pessoa
   * sondava quais `externalId` existiam na base. Aqui exige administrador.
   */
  async checkDuplicates(events: Record<string, unknown>[]) {
    const externalId = (event: Record<string, unknown>) =>
      typeof event.externalId === 'string' ? event.externalId.trim() : '';

    const ids = [...new Set(events.map(externalId).filter(Boolean))];

    const existing = ids.length
      ? await this.prisma.event.findMany({
          where: { externalId: { in: ids } },
          select: { id: true, externalId: true, slug: true },
        })
      : [];

    const byExternalId = new Map(
      existing.map((event) => [event.externalId, event]),
    );

    const checked = events.map((event) => {
      const match = byExternalId.get(externalId(event)) ?? null;

      return {
        ...event,
        alreadyExists: !!match,
        isDuplicate: !!match,
        existingEventId: match?.id,
        existingEventSlug: match?.slug,
        selected: !match,
      };
    });

    const duplicates = checked.filter((event) => event.alreadyExists).length;

    return {
      success: true,
      events: checked,
      duplicates,
      new: events.length - duplicates,
    };
  }

  /**
   * Importa os eventos escolhidos.
   *
   * **O legado só sabia achar a casa de duas das sete** (`osesp` e
   * `theatro-municipal`). Nas outras, a casa ficava nula e a rota devolvia 500
   * **no meio do laço**, depois de parte dos eventos gravada e sem registrar a
   * rodada. Aqui a importação é a mesma dos scrapers na fila (`ImportService`):
   * a casa sai da configuração do próprio scraper, duplicata é conferida por
   * evento, e a rodada fica registrada.
   */
  async bulkInsert(scraperId: string, events: ScrapedEventDto[]) {
    if (!this.registry.isRegistered(scraperId)) {
      throw new BadRequestException(`Scraper desconhecido: "${scraperId}"`);
    }

    const result = await this.importer.importEvents(
      scraperId,
      events.map(toScrapedEvent),
    );

    return {
      success: true,
      message: result.message,
      imported: result.imported,
      duplicates: result.duplicates,
      failed: result.failed,
      // O formato que o modal do legado lê: `results[i].success` e `eventId`.
      results: result.details.map((detail) => ({
        success: detail.status === 'success',
        eventId: detail.eventId,
        title: detail.title,
        isDuplicate: detail.status === 'duplicate',
        error: detail.status === 'error' ? detail.message : undefined,
      })),
    };
  }
}

function toScrapedEvent(dto: ScrapedEventDto): ScrapedEvent {
  return {
    title: dto.title.trim(),
    slug: dto.slug,
    description: dto.description ?? '',
    type: dto.type,
    startDate: new Date(dto.startDate),
    startTime: dto.startTime ?? null,
    endDate: dto.endDate ? new Date(dto.endDate) : null,
    endTime: dto.endTime ?? null,
    venueDetails: dto.venueDetails ?? null,
    ticketUrl: urlField(dto.ticketUrl, 'link', 'ticketUrl') ?? null,
    externalUrl: urlField(dto.externalUrl, 'link', 'externalUrl') ?? null,
    ticketInfo: dto.ticketInfo ?? null,
    externalId: dto.externalId.trim(),
    imageUrl: urlField(dto.imageUrl, 'media', 'imageUrl') ?? null,
    composerNames: dto.composerNames ?? [],
    performers: dto.performers ?? [],
    program: dto.program ?? null,
    duration: dto.duration,
  };
}
