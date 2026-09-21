import { escapeRegex } from '../../common/utils/regex.util';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScraperRegistry } from '../scraper-registry';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import { EventStatus, EventSource } from '@prisma/client';
import { errorMessage } from '../../common/utils/error.util';

export interface ImportResult {
  success: boolean;
  message: string;
  imported: number;
  failed: number;
  duplicates: number;
  details: ImportDetail[];
}

export interface ImportDetail {
  eventId?: string;
  externalId: string;
  title: string;
  status: 'success' | 'error' | 'duplicate';
  message: string;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ScraperRegistry,
    private readonly cache: AppCacheService,
  ) {}

  async importEvents(
    scraperId: string,
    events: ScrapedEvent[],
  ): Promise<ImportResult> {
    if (!events || events.length === 0) {
      return {
        success: false,
        message: 'Nenhum evento fornecido',
        imported: 0,
        failed: 0,
        duplicates: 0,
        details: [],
      };
    }

    this.logger.log(`Importando ${events.length} eventos de ${scraperId}`);

    // A casa de espetáculo é a mesma para todos os eventos da rodada. Resolver
    // dentro do laço era uma consulta (e possivelmente uma escrita) por evento.
    const venue = await this.getOrCreateVenue(scraperId);

    const results: ImportDetail[] = [];
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (const event of events) {
      try {
        // Verificar duplicata
        // `externalId` vazio não pode entrar no `OR`: seria um ramo que casa
        // com qualquer evento cujo campo também esteja vazio, e a rodada
        // inteira sairia marcada como duplicata. Sem id do provedor, sobra o
        // par título + data, que é o que identifica o espetáculo.
        const existing = await this.prisma.event.findFirst({
          where: {
            OR: [
              ...(event.externalId ? [{ externalId: event.externalId }] : []),
              {
                AND: [
                  { title: event.title },
                  { startDate: new Date(event.startDate) },
                ],
              },
            ],
          },
        });

        if (existing) {
          duplicates++;
          results.push({
            externalId: event.externalId,
            title: event.title,
            status: 'duplicate',
            message: 'Evento já existe',
          });
          this.logger.debug(`Duplicata ignorada: ${event.title}`);
          continue;
        }

        // Buscar compositores
        const composerIds = await this.findComposers(event.composerNames || []);

        // Gerar slug único
        const slug = await this.generateUniqueSlug(event.slug);

        // Mapear source
        const source = this.mapScraperToSource(scraperId);

        // `ScrapedEvent.type` já é `EventType` — o cast anterior mascarava
        // valores inválidos vindos dos scrapers (ver `detectEventType`).
        const eventType = event.type;

        // Criar evento
        const createdEvent = await this.prisma.event.create({
          data: {
            title: event.title,
            slug,
            description: event.description,
            type: eventType, // ✅ CORRIGIDO
            status: EventStatus.PUBLISHED,
            source,
            startDate: new Date(event.startDate),
            // **O horário é opcional, e isso é sobre o mundo, não sobre o
            // banco.** `startTime` era `String` obrigatório, e a Cidade das
            // Artes publica **temporada**, não sessão: "Wicked, 15/07 a 04/10"
            // é um período de quase três meses, sem um horário só. Os 19
            // eventos dela eram recusados um a um por "sem horário de início".
            // As alternativas eram perder a casa inteira ou inventar um
            // horário e mostrá-lo ao público como se fosse informação — a
            // mesma escolha que a data "1º de janeiro" do IMSLP.
            startTime: event.startTime,
            endDate: event.endDate ? new Date(event.endDate) : null,
            endTime: event.endTime,
            venueId: venue.id,
            venueDetails: event.venueDetails,
            ticketUrl: event.ticketUrl,
            externalUrl: event.externalUrl,
            ticketInfo: event.ticketInfo,
            externalId: event.externalId,
            imageUrl: event.imageUrl,
            program: event.program,
            composerIds,
            isFree:
              event.ticketInfo?.toLowerCase().includes('gratuito') || false,
          },
        });

        imported++;
        results.push({
          eventId: createdEvent.id,
          externalId: event.externalId,
          title: event.title,
          status: 'success',
          message: 'Evento importado com sucesso',
        });

        this.logger.debug(`Importado: ${event.title}`);
      } catch (error) {
        errors++;
        results.push({
          externalId: event.externalId,
          title: event.title,
          status: 'error',
          message: errorMessage(error) || 'Erro ao importar evento',
        });
        this.logger.warn(
          `Falha ao importar "${event.title}": ${errorMessage(error)}`,
        );
      }
    }

    // Registrar log (se a tabela existir)
    try {
      await this.prisma.scrapingLog.create({
        data: {
          source: scraperId,
          status: imported > 0 ? 'success' : 'error',
          eventsFound: events.length,
          eventsCreated: imported,
          eventsSkipped: duplicates,
          newEvents: imported,
          details: { errors },
          finishedAt: new Date(),
        },
      });
    } catch (logError) {
      this.logger.warn(
        `Não foi possível registrar o log de scraping: ${errorMessage(logError)}`,
      );
    }

    // O calendário do blog tem cache; evento novo precisa aparecer nele. A
    // importação roda no worker, mas o Redis é o mesmo da API.
    if (imported > 0) {
      await this.cache.invalidateMany([CacheNamespace.BLOG_CALENDAR]);
    }

    return {
      success: true,
      message: `${imported} evento(s) importado(s), ${duplicates} duplicata(s), ${errors} erro(s)`,
      imported,
      failed: errors,
      duplicates,
      details: results,
    };
  }

  // ==================== HELPER FUNCTIONS ====================

  /**
   * A casa de espetáculo desta rodada.
   *
   * **Os dados vêm da configuração do próprio scraper.** O `ImportService`
   * tinha um mapa próprio com **duas das sete** casas, e a falta estourava
   * antes do laço: importar a Sala Cecília Meireles, o Theatro da Paz ou a
   * Cidade das Artes falhava inteira, com "Venue não configurado". As duas
   * listas também já discordavam — o mapa dizia `theatro-municipal-sp` e o
   * scraper dizia `theatro-municipal`, o que criaria duas casas para o mesmo
   * teatro. Agora há uma fonte só, e ela é a mesma que o scraper usa para se
   * identificar.
   */
  private async getOrCreateVenue(scraperId: string) {
    const config = this.registry.require(scraperId).getConfig();

    return this.prisma.venue.upsert({
      where: { slug: config.venueSlug },
      // **Não sobrescreve a casa existente.** Endereço e descrição podem ter
      // sido corrigidos à mão no painel, e uma rodada de scraping não é hora
      // de desfazer isso.
      update: {},
      create: {
        name: config.venueName,
        slug: config.venueSlug,
        website: config.baseUrl,
        ...config.venue,
      },
    });
  }

  /**
   * Buscar compositores por nome
   */
  private async findComposers(composerNames: string[]): Promise<string[]> {
    if (!composerNames || composerNames.length === 0) return [];

    const composerIds: string[] = [];

    for (const name of composerNames) {
      const composer = await this.prisma.composer.findFirst({
        where: {
          OR: [
            { fullName: { contains: escapeRegex(name), mode: 'insensitive' } },
            { name: { contains: escapeRegex(name), mode: 'insensitive' } },
          ],
        },
      });

      if (composer) {
        composerIds.push(composer.id);
      }
    }

    return composerIds;
  }

  /**
   * Gerar slug único (evitar duplicatas)
   */
  private async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (await this.prisma.event.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * De onde o evento veio.
   *
   * **Todo scraper registrado é `SCRAPER`.** O mapa anterior listava dois, e os
   * outros cinco caíam em `ADMIN` — o que diria que a programação do Theatro
   * da Paz foi cadastrada por uma pessoa no painel. Era a mesma duplicação de
   * lista do mapa de casas, com o mesmo desfecho.
   */
  private mapScraperToSource(scraperId: string): EventSource {
    return this.registry.isRegistered(scraperId)
      ? EventSource.SCRAPER
      : EventSource.ADMIN;
  }
}
