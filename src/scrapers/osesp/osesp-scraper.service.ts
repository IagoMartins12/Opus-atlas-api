import { Injectable } from '@nestjs/common';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ScrapedEvent,
  ScraperResponse,
} from '../../common/interfaces/scraped-event.interface';
import * as cheerio from 'cheerio';
import {
  cleanHtml,
  extractComposerNames,
  detectEventType,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';
import { loadComposerCache } from '../../utils/composer-matcher';

interface OSESPScraperOptions {
  includeUpcomingEvents?: boolean; // Coleta de /concertos-ingressos
  includeSeason?: boolean; // Coleta de /temporada-osesp
  seasonYear?: number; // Ano da temporada (default: próximo ano)
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
  async scrapeEvents(): Promise<ScrapedEvent[]> {
    console.log('🎵 Starting OSESP Scraper...\n');
    await loadComposerCache();

    const allEventUrls: string[] = [];

    // 1. Coleta eventos próximos (/concertos-ingressos)
    if (this.options.includeUpcomingEvents) {
      console.log('📅 Collecting upcoming events...');
      const upcomingUrls = await this.scrapeUpcomingEvents();
      allEventUrls.push(...upcomingUrls);
      console.log(`   Found ${upcomingUrls.length} upcoming events`);
    }

    // 2. Coleta temporada futura (/temporada-osesp) com paginação
    if (this.options.includeSeason) {
      console.log(`📅 Collecting season ${this.options.seasonYear} events...`);
      const seasonUrls = await this.scrapeSeasonEvents();
      allEventUrls.push(...seasonUrls);
      console.log(`   Found ${seasonUrls.length} season events`);
    }

    // Remove duplicatas
    const uniqueUrls = [...new Set(allEventUrls)];
    this.state.eventsFound = uniqueUrls.length;

    console.log(`\n📋 Total unique events found: ${uniqueUrls.length}\n`);

    const events: ScrapedEvent[] = [];
    let composerMatchCount = 0;

    for (const url of uniqueUrls) {
      try {
        await this.delay();
        const event = await this.scrapeEventDetails(url);

        if (event) {
          events.push(event);
          this.state.eventsScraped++;

          if (event.composerNames.length > 0) {
            composerMatchCount++;
            console.log(
              `✅ [${this.state.eventsScraped}/${uniqueUrls.length}] ${event.title} (${event.composerNames.length} composer(s))`,
            );
          } else {
            console.log(
              `⚠️  [${this.state.eventsScraped}/${uniqueUrls.length}] ${event.title} (no composers)`,
            );
          }
        }
      } catch (error: any) {
        console.error(`❌ Error scraping ${url}:`, error.message);
        this.state.errors.push(`Failed to scrape ${url}: ${error.message}`);
      }
    }

    console.log(
      `\n🎼 Composer detection: ${composerMatchCount}/${events.length} events`,
    );

    return events;
  }

  /**
   * ✅ Coleta eventos da página "Concertos e Ingressos" (eventos próximos)
   */
  private async scrapeUpcomingEvents(): Promise<string[]> {
    const html = await this.fetchWithRetry(
      `${this.config.baseUrl}/osesp/concertos-ingressos`,
    );

    return this.extractEventUrlsFromPage(html);
  }

  /**
   * ✅ NOVO: Coleta eventos da "Temporada" com paginação automática
   */
  private async scrapeSeasonEvents(): Promise<string[]> {
    const allUrls: string[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      try {
        const url = `${this.config.baseUrl}/osesp/pt/temporada-osesp?pageconcerts=${currentPage}`;
        console.log(`   📄 Fetching page ${currentPage}...`);

        const html = await this.fetchWithRetry(url);
        const pageUrls = this.extractEventUrlsFromPage(html);

        if (pageUrls.length === 0) {
          console.log(
            `   ✓ No more events found. Stopping at page ${currentPage - 1}.`,
          );
          hasMorePages = false;
        } else {
          allUrls.push(...pageUrls);
          console.log(`   ✓ Page ${currentPage}: ${pageUrls.length} events`);
          currentPage++;

          // Delay entre páginas
          await this.delay(1500);
        }

        // ✅ Safety check: limite máximo de páginas (evita loop infinito)
        if (currentPage > 20) {
          console.warn(`   ⚠️  Reached max page limit (20). Stopping.`);
          hasMorePages = false;
        }
      } catch (error: any) {
        console.error(`   ❌ Error on page ${currentPage}:`, error.message);
        hasMorePages = false;
      }
    }

    return allUrls;
  }

  /**
   * ✅ Extrai URLs de eventos de uma página HTML
   * (Funciona para ambas: /concertos-ingressos e /temporada-osesp)
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

      // Ignora links externos
      const externalLink = $card.find('a[href*="sympla"]').attr('href');
      if (externalLink) {
        console.log(`   ⏭️  Skipping external link: ${externalLink}`);
      }
    });

    return eventUrls;
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
      console.warn('⚠️ Skipping event (missing title or date):', url);
      return null;
    }

    const type = detectEventType(title, description);
    const textForComposers = `${title}${description}${program}`;
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
      ticketUrl: ticketUrl || url, // URL de ingressos (Sympla ou página)
      externalUrl: url, // ✅ URL da página do evento
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

  /**
   * ✅ MÉTODO COMPLETO: Scrape + Verificação de Duplicatas
   */
  async scrapeAndCheckDuplicates(): Promise<ScraperResponse> {
    const startTime = Date.now();

    try {
      // 1. Fazer o scraping
      const scrapedEvents = await this.scrapeEvents();

      // 2. Verificar duplicatas no banco
      const newEvents: ScrapedEvent[] = [];
      let duplicates = 0;

      for (const event of scrapedEvents) {
        const existingEvent = await this.prisma.event.findFirst({
          where: {
            OR: [
              { externalId: event.externalId },
              {
                AND: [{ title: event.title }, { startDate: event.startDate }],
              },
            ],
          },
        });

        if (existingEvent) {
          duplicates++;
          this.log(`⚠️ Duplicata detectada: ${event.title}`);
        } else {
          newEvents.push(event);
        }
      }

      const executionTime = Date.now() - startTime;

      this.log(`
        📊 Resumo:
        - Total scraped: ${scrapedEvents.length}
        - Novos eventos: ${newEvents.length}
        - Duplicatas: ${duplicates}
        - Tempo: ${executionTime}ms
      `);

      return {
        success: true,
        eventsFound: this.state.eventsFound,
        eventsScraped: this.state.eventsScraped,
        newEvents: newEvents.length,
        duplicates,
        events: newEvents,
        errors: this.state.errors,
        executionTime,
      };
    } catch (error) {
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
    }
  }
}
