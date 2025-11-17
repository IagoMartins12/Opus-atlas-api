import { Injectable } from '@nestjs/common';
import {
  BaseScraper,
  ScraperConfig,
  ScraperResponse,
} from '../base/base-scraper';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import * as cheerio from 'cheerio';
import {
  cleanHtml,
  extractComposerNames,
  detectEventType,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';

interface OSESPScraperOptions {
  includeUpcomingEvents?: boolean;
  includeSeason?: boolean;
  seasonYear?: number;
}

@Injectable()
export class OsespScraperService extends BaseScraper {
  private options: OSESPScraperOptions;

  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Sala São Paulo',
      venueSlug: 'sala-sao-paulo',
      baseUrl: 'https://osesp.art.br',
      delayBetweenRequests: 2000,
    };
    super(config);

    this.options = {
      includeUpcomingEvents: true,
      includeSeason: true,
      seasonYear: new Date().getFullYear() + 1,
    };
  }

  /**
   * 🎯 MÉTODO PRINCIPAL - Scrape de eventos
   */
  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    this.log('🎵 Starting OSESP Scraper...\n');

    try {
      let eventCounter = 0;

      // 1. Coletar eventos próximos (10% do progresso)
      this.log('📅 Collecting upcoming events...');
      onProgress?.(5, 100, 'Coletando eventos próximos...');

      const upcomingEvents = await this.scrapeUpcomingEvents();
      this.log(`   Found ${upcomingEvents.length} upcoming events`);

      // 2. Coletar temporada (20% do progresso)
      this.log(`📅 Collecting season ${this.options.seasonYear} events...`);
      onProgress?.(15, 100, 'Coletando eventos da temporada...');

      const seasonEvents = await this.scrapeSeasonEvents();
      this.log(`   Found ${seasonEvents.length} season events\n`);

      // 3. Combinar e remover duplicatas (25% do progresso)
      onProgress?.(20, 100, 'Removendo duplicatas...');
      const allEventUrls = this.removeDuplicateUrls([
        ...upcomingEvents,
        ...seasonEvents,
      ]);

      this.log(`📋 Total unique events found: ${allEventUrls.length}\n`);
      onProgress?.(
        25,
        100,
        `${allEventUrls.length} eventos únicos encontrados`,
      );

      // 4. Processar cada evento (25% - 100% do progresso)
      const processedEvents: ScrapedEvent[] = [];
      const totalEvents = allEventUrls.length;

      for (const eventUrl of allEventUrls) {
        eventCounter++;

        // ✅ CALCULAR PROGRESSO (de 25% a 100%)
        const progressPercentage =
          25 + Math.round((eventCounter / totalEvents) * 75);

        try {
          onProgress?.(
            progressPercentage,
            100,
            `Processando evento ${eventCounter}/${totalEvents}...`,
          );

          const event = await this.scrapeEventDetails(eventUrl);

          if (event) {
            processedEvents.push(event);
            const composerInfo =
              event.composerNames.length > 0
                ? `(${event.composerNames.length} composer(s))`
                : '(no composers)';

            this.log(
              `${event.composerNames.length > 0 ? '✅' : '⚠️ '} [${eventCounter}/${totalEvents}] ${event.title} ${composerInfo}`,
            );
          }

          // Delay entre requisições
          await this.delay(this.config.delayBetweenRequests);
        } catch (error) {
          this.state.errors.push(
            `Error processing event ${eventCounter}: ${error.message}`,
          );
          this.log(
            `❌ [${eventCounter}/${totalEvents}] ${eventUrl}: ${error.message}`,
          );
        }
      }

      // ✅ Estatísticas finais
      const eventsWithComposers = processedEvents.filter(
        (e) => e.composerNames.length > 0,
      ).length;

      this.log(
        `\n🎼 Composer detection: ${eventsWithComposers}/${processedEvents.length} events`,
      );
      this.log(`[${this.config.venueName}]`);

      this.state.eventsFound = totalEvents;
      this.state.eventsScraped = processedEvents.length;

      return processedEvents;
    } catch (error) {
      this.log(`❌ Fatal error in scrapeEvents: ${error.message}`);
      onProgress?.(0, 100, `Erro: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ MÉTODO COMPLETO: Scrape + Verificação de Duplicatas COM PROGRESSO
   */
  async scrapeAndCheckDuplicates(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScraperResponse> {
    const startTime = Date.now();

    try {
      // ✅ RESETAR estado
      this.state = {
        eventsFound: 0,
        eventsScraped: 0,
        errors: [],
        startTime: Date.now(),
      };

      // 1. Fazer o scraping (0% - 80%)
      onProgress?.(0, 100, 'Iniciando scraper...');

      // ✅ PASSAR O CALLBACK DE PROGRESSO
      const scrapedEvents = await this.scrapeEvents(
        (current, total, message) => {
          // Mapear progresso de scrapeEvents (0-100) para 0-80% do total
          const mappedProgress = Math.round((current / 100) * 80);
          onProgress?.(mappedProgress, 100, message);
        },
      );

      onProgress?.(
        80,
        100,
        `${scrapedEvents.length} eventos coletados. Verificando duplicatas...`,
      );

      // 2. Verificar duplicatas no banco (80% - 100%)
      const allEvents: ScrapedEvent[] = [];
      let duplicates = 0;
      const total = scrapedEvents.length;

      for (let i = 0; i < scrapedEvents.length; i++) {
        const event = scrapedEvents[i];

        // ✅ PROGRESSO DE VERIFICAÇÃO (80% - 100%)
        const progressPercentage = 80 + Math.round((i / total) * 20);
        onProgress?.(
          progressPercentage,
          100,
          `Verificando duplicatas: ${i + 1}/${total}`,
        );

        const existingEvent = await this.prisma.event.findFirst({
          where: {
            OR: [
              { externalId: event.externalId },
              {
                AND: [{ title: event.title }, { startDate: event.startDate }],
              },
            ],
          },
          select: {
            id: true,
            slug: true,
          },
        });

        if (existingEvent) {
          duplicates++;
          allEvents.push({
            ...event,
            isDuplicate: true,
            existingEventId: existingEvent.id,
            existingEventSlug: existingEvent.slug,
          } as any);
          this.log(`⚠️ Duplicata detectada: ${event.title}`);
        } else {
          allEvents.push({
            ...event,
            isDuplicate: false,
          } as any);
        }
      }

      const executionTime = Date.now() - startTime;

      // ✅ 100% COMPLETO
      onProgress?.(100, 100, 'Scraper concluído!');

      this.log(`
📊 Resumo:
- Total scraped: ${scrapedEvents.length}
- Novos eventos: ${allEvents.filter((e: any) => !e.isDuplicate).length}
- Duplicatas: ${duplicates}
- Tempo: ${executionTime}ms
    `);

      return {
        success: true,
        eventsFound: this.state.eventsFound,
        eventsScraped: this.state.eventsScraped,
        newEvents: allEvents.filter((e: any) => !e.isDuplicate).length,
        duplicates,
        events: allEvents,
        errors: this.state.errors,
        executionTime,
      };
    } catch (error) {
      this.log(`❌ Erro no scraping: ${error.message}`);
      onProgress?.(0, 100, `Erro: ${error.message}`);

      return {
        success: false,
        eventsFound: 0,
        eventsScraped: 0,
        newEvents: 0,
        duplicates: 0,
        events: [],
        errors: [error instanceof Error ? error.message : String(error)],
        executionTime: Date.now() - startTime,
      };
    } finally {
      this.state = {
        eventsFound: 0,
        eventsScraped: 0,
        errors: [],
        startTime: Date.now(),
      };
    }
  }
  /**
   * ✅ Coleta eventos da página "Concertos e Ingressos"
   */
  private async scrapeUpcomingEvents(): Promise<string[]> {
    const html = await this.fetchWithRetry(
      `${this.config.baseUrl}/osesp/concertos-ingressos`,
    );

    return this.extractEventUrlsFromPage(html);
  }

  /**
   * ✅ Coleta eventos da "Temporada" com paginação
   */
  private async scrapeSeasonEvents(): Promise<string[]> {
    const allUrls: string[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        const url = `${this.config.baseUrl}/osesp/pt/temporada-osesp?pageconcerts=${currentPage}`;
        this.log(`   📄 Fetching page ${currentPage}...`);

        const html = await this.fetchWithRetry(url);
        const pageUrls = this.extractEventUrlsFromPage(html);

        if (pageUrls.length === 0) {
          this.log(
            `   ✓ No more events found. Stopping at page ${currentPage - 1}.`,
          );
          hasMorePages = false;
        } else {
          allUrls.push(...pageUrls);
          this.log(`   ✓ Page ${currentPage}: ${pageUrls.length} events`);
          currentPage++;

          // Delay entre páginas
          await this.delay(1500);
        }

        // Safety check
        if (currentPage > 20) {
          this.log(`   ⚠️  Reached max page limit (20). Stopping.`);
          hasMorePages = false;
        }
      } catch (error: any) {
        this.log(`   ❌ Error on page ${currentPage}: ${error.message}`);
        hasMorePages = false;
      }
    }

    return allUrls;
  }

  /**
   * ✅ Extrai URLs de eventos de uma página HTML
   */
  private extractEventUrlsFromPage(html: string): string[] {
    const $ = cheerio.load(html);
    const eventUrls: string[] = [];

    $('.card[data-astro-cid-np5upjzn], .card').each((_, element) => {
      const $card = $(element);
      const link = $card.find('a[href*="/concerto/"]').first().attr('href');

      if (link) {
        const fullUrl = link.startsWith('http')
          ? link
          : `${this.config.baseUrl}${link}`;

        if (
          (fullUrl.includes('osesp.art.br') ||
            fullUrl.includes('salasaopaulo.art.br')) &&
          !eventUrls.includes(fullUrl)
        ) {
          eventUrls.push(fullUrl);
        }
      }
    });

    return eventUrls;
  }

  /**
   * ✅ Remove URLs duplicadas
   */
  private removeDuplicateUrls(urls: string[]): string[] {
    return [...new Set(urls)];
  }

  /**
   * Scrape detalhes de um evento específico
   */
  private async scrapeEventDetails(url: string): Promise<ScrapedEvent | null> {
    const html = await this.fetchWithRetry(url);
    const $ = cheerio.load(html);

    const title = this.extractTitle($);
    const description = this.extractDescription($);
    const { date, time } = this.extractDateTime($);
    const venue = this.extractVenue($);
    const { ticketUrl, ticketInfo, isFree } = this.extractTicketInfo($);
    const imageUrl = this.extractImageUrl($);
    const program = this.extractProgram($);

    if (!title || !date) {
      this.log(`⚠️ Skipping event (missing title or date): ${url}`);
      return null;
    }

    const type = detectEventType(title, description);
    const textForComposers = `${title} ${description} ${program}`;
    let composerNames = extractComposerNames(textForComposers);

    // Remover falsos positivos
    if (
      composerNames.includes('Wagner') &&
      textForComposers.includes('Wagner Polistchuk')
    ) {
      composerNames = composerNames.filter((c) => c !== 'Wagner');
    }
    if (
      composerNames.includes('Berlioz') &&
      !program?.includes('BERLIOZ') &&
      !program?.includes('Berlioz')
    ) {
      composerNames = composerNames.filter((c) => c !== 'Berlioz');
    }

    const externalId = `osesp-${createSlug(title)}-${date.getTime()}`;

    return {
      title,
      slug: createSlug(title),
      description,
      type,
      startDate: date,
      startTime: time,
      endDate: null,
      endTime: null,
      venueDetails: venue,
      ticketUrl: ticketUrl || url,
      externalUrl: url,
      ticketInfo: isFree ? 'Entrada gratuita' : ticketInfo,
      externalId,
      imageUrl,
      composerNames,
      performers: [],
      program: program,
    };
  }

  // ✅ Métodos de extração
  private extractTitle($: cheerio.Root): string {
    let title = $('.article-header h1.text-title--1').first().text().trim();
    if (!title) title = $('h1').first().text().trim();
    if (!title) title = $('title').text().trim();
    return cleanHtml(title);
  }

  private extractDescription($: cheerio.Root): string {
    let description = $('.article-program p').text().trim();
    description = description.replace(/\n\s*\n/g, '\n').trim();
    if (!description || description.length < 50) {
      description = $('article p').first().text().trim();
    }
    return cleanHtml(description);
  }

  private extractDateTime($: cheerio.Root): {
    date: Date | null;
    time: string | null;
  } {
    const dateText = $('.article-details span.first-uppercase')
      .filter((_, el) => {
        const parent = $(el).parent();
        return parent.text().includes('Data:');
      })
      .first()
      .text()
      .trim();

    const timeText = $('.article-details span.first-uppercase')
      .filter((_, el) => {
        const parent = $(el).parent();
        return parent.text().includes('Horário:');
      })
      .first()
      .text()
      .trim();

    if (dateText) {
      const dateMatch = dateText.match(
        /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      );

      if (dateMatch) {
        const months: { [key: string]: number } = {
          janeiro: 0,
          fevereiro: 1,
          março: 2,
          abril: 3,
          maio: 4,
          junho: 5,
          julho: 6,
          agosto: 7,
          setembro: 8,
          outubro: 9,
          novembro: 10,
          dezembro: 11,
        };

        const day = parseInt(dateMatch[1]);
        const month = months[dateMatch[2].toLowerCase()];
        const year = parseInt(dateMatch[3]);

        if (month !== undefined) {
          const date = new Date(year, month, day);
          return { date, time: timeText || null };
        }
      }
    }

    return { date: null, time: null };
  }

  private extractVenue($: cheerio.Root): string | null {
    const venueText = $('.article-details div')
      .filter((_, el) => {
        return $(el).text().includes('Local:');
      })
      .find('a')
      .first()
      .text()
      .trim();

    if (venueText) {
      return cleanHtml(venueText);
    }

    return 'Sala São Paulo';
  }

  private extractTicketInfo($: cheerio.Root): {
    ticketUrl: string | null;
    ticketInfo: string | null;
    isFree: boolean;
  } {
    const ticketLink = $(
      '.article-details a.btn.primary, a:contains("Retirar ingresso"), a:contains("Comprar ingresso")',
    )
      .first()
      .attr('href');

    const priceDiv = $('.article-details div')
      .filter((_, el) => {
        return $(el).text().includes('Preço:');
      })
      .first()
      .text()
      .trim();

    const priceText = priceDiv.replace('Preço:', '').trim();
    const isFree = priceText.toLowerCase().includes('gratuito');

    return {
      ticketUrl: ticketLink || null,
      ticketInfo: priceText || null,
      isFree,
    };
  }

  private extractProgram($: cheerio.Root): string | null {
    const programSection = $('.article-program');

    if (programSection.length > 0) {
      const title = programSection.find('h2').text();
      let programText = programSection.text().trim();

      if (title) {
        programText = programText.replace(title, '').trim();
      }

      return cleanHtml(programText);
    }

    return null;
  }

  private extractImageUrl($: cheerio.Root): string | null {
    const imgSrc = $('.hero img').first().attr('src');

    if (imgSrc) {
      return imgSrc.startsWith('http')
        ? imgSrc
        : `${this.config.baseUrl}${imgSrc}`;
    }

    return null;
  }
}
