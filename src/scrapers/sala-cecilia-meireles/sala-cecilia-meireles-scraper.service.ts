// sala-cecilia-meireles-scraper.service.ts
import { Injectable } from '@nestjs/common';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import * as cheerio from 'cheerio';
import {
  extractComposerNames,
  detectEventType,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';

@Injectable()
export class SalaCeciliaMeirelesScraperService extends BaseScraper {
  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Sala Cecília Meireles',
      venueSlug: 'sala-cecilia-meireles',
      baseUrl: 'https://salaceciliameireles.com.br',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      onProgress?.(0, 100, 'Iniciando scraper Sala Cecília Meireles...');

      const html = await this.fetchWithRetry(
        `${this.config.baseUrl}/programacao`,
      );
      const $ = cheerio.load(html);

      const events: ScrapedEvent[] = [];
      const eventElements = $('.evento-item, .programacao-item, .concert-card');

      onProgress?.(20, 100, `${eventElements.length} eventos encontrados`);

      eventElements.each((index, element) => {
        const $elem = $(element);

        // Extração de dados
        const title = $elem
          .find('.titulo, .event-title, h2, h3')
          .first()
          .text()
          .trim();
        const dateText = $elem
          .find('.data, .event-date, time')
          .first()
          .text()
          .trim();
        const timeText = $elem
          .find('.horario, .event-time')
          .first()
          .text()
          .trim();
        const description = $elem
          .find('.descricao, .event-description, p')
          .first()
          .text()
          .trim();
        const imageUrl = $elem.find('img').first().attr('src') || null;
        const eventUrl = $elem.find('a').first().attr('href') || null;

        if (!title || !dateText) return;

        const startDate = this.parsePortugueseDate(dateText);
        if (!startDate) return;

        const startTime = this.parseTime(timeText) || '20:00';
        const eventType = detectEventType(title, description);

        const composerNames = extractComposerNames(`${title} ${description}`);

        const externalId = `sala-cecilia-meireles-${createSlug(title)}-${startDate.getTime()}`;

        events.push({
          title,
          slug: createSlug(`${title}-${startDate.toISOString()}`),
          description: description || title,
          type: eventType,
          startDate,
          startTime,
          endDate: null,
          endTime: null,
          venueDetails: 'Sala Cecília Meireles',
          ticketUrl: eventUrl ? `${this.config.baseUrl}${eventUrl}` : null,
          externalUrl: eventUrl ? `${this.config.baseUrl}${eventUrl}` : null,
          ticketInfo: null,
          externalId,
          imageUrl: imageUrl ? `${this.config.baseUrl}${imageUrl}` : null,
          composerNames,
          performers: [],
          program: null,
        });

        const progress = 20 + Math.round((index / eventElements.length) * 80);
        onProgress?.(
          progress,
          100,
          `Processando evento ${index + 1}/${eventElements.length}`,
        );
      });

      onProgress?.(100, 100, 'Scraper concluído!');
      this.log(`✅ ${events.length} eventos coletados`);

      return events;
    } catch (error) {
      this.logError(error);
      throw error;
    }
  }

  private parsePortugueseDate(text: string): Date | null {
    // Formato: "28 de novembro de 2025" ou "28/11/2025"
    const dateRegex1 = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
    const dateRegex2 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

    let match = text.match(dateRegex1);
    if (match) {
      const [, day, monthName, year] = match;
      const months: Record<string, number> = {
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
      const monthIndex = months[monthName.toLowerCase()];
      if (monthIndex !== undefined) {
        return new Date(parseInt(year), monthIndex, parseInt(day));
      }
    }

    match = text.match(dateRegex2);
    if (match) {
      const [, day, month, year] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return null;
  }

  private parseTime(text: string): string | null {
    const timeMatch = text.match(/(\d{1,2}):?(\d{2})/);
    if (timeMatch) {
      const [, hour, minute] = timeMatch;
      return `${hour.padStart(2, '0')}:${minute}`;
    }
    return null;
  }
}
