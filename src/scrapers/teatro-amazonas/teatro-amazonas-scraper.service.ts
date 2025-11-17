// teatro-amazonas-scraper.service.ts
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
export class TeatroAmazonasScraperService extends BaseScraper {
  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Teatro Amazonas',
      venueSlug: 'teatro-amazonas',
      baseUrl: 'https://cultura.am.gov.br',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      delayBetweenRequests: 2000,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      onProgress?.(0, 100, 'Iniciando scraper Teatro Amazonas...');

      // Buscar programação atual
      const html = await this.fetchWithRetry(
        `${this.config.baseUrl}/teatro-amazonas/programacao`,
      );
      const $ = cheerio.load(html);

      const events: ScrapedEvent[] = [];

      // Buscar eventos listados
      $('.evento, .programacao-item, .event-card, article').each(
        (index, element) => {
          const $elem = $(element);

          const title = $elem
            .find('h2, h3, .titulo, .event-title')
            .first()
            .text()
            .trim();
          const dateText = $elem
            .find('.data, .date, time')
            .first()
            .text()
            .trim();
          const timeText = $elem.find('.horario, .time').first().text().trim();
          const description = $elem
            .find('p, .descricao, .description')
            .first()
            .text()
            .trim();
          const imageUrl = $elem.find('img').first().attr('src') || null;
          const linkUrl = $elem.find('a').first().attr('href') || null;

          if (!title || !dateText) return;

          const startDate = this.parseDateFromText(dateText);
          if (!startDate) return;

          const startTime = this.extractTime(timeText) || '20:00';
          const eventType = detectEventType(title, description);
          const composerNames = extractComposerNames(`${title} ${description}`);

          // Detecção de preço
          let ticketInfo: string | null = null;
          const bodyText = $elem.text().toLowerCase();
          if (
            bodyText.includes('gratuito') ||
            bodyText.includes('grátis') ||
            bodyText.includes('entrada franca')
          ) {
            ticketInfo = 'Entrada gratuita';
          } else if (bodyText.match(/r\$\s*\d+/)) {
            const priceMatch = bodyText.match(/r\$\s*(\d+)/);
            if (priceMatch) ticketInfo = `A partir de R$ ${priceMatch[1]}`;
          }

          const externalId = `teatro-amazonas-${createSlug(title)}-${startDate.getTime()}`;

          events.push({
            title,
            slug: createSlug(`${title}-${startDate.toISOString()}`),
            description: description || title,
            type: eventType,
            startDate,
            startTime,
            endDate: null,
            endTime: null,
            venueDetails: 'Teatro Amazonas',
            ticketUrl: linkUrl ? `${this.config.baseUrl}${linkUrl}` : null,
            externalUrl: linkUrl ? `${this.config.baseUrl}${linkUrl}` : null,
            ticketInfo,
            externalId,
            imageUrl: imageUrl
              ? imageUrl.startsWith('http')
                ? imageUrl
                : `${this.config.baseUrl}${imageUrl}`
              : null,
            composerNames,
            performers: [],
            program: null,
          });
        },
      );

      onProgress?.(100, 100, 'Scraper concluído!');
      this.log(`✅ ${events.length} eventos coletados`);

      return events;
    } catch (error) {
      this.logError(error);
      throw error;
    }
  }

  private parseDateFromText(text: string): Date | null {
    // Suporte para múltiplos formatos
    const formats = [
      /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      /(\d{4})-(\d{2})-(\d{2})/,
    ];

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

    for (const regex of formats) {
      const match = text.match(regex);
      if (match) {
        if (regex.source.includes('de')) {
          const [, day, monthName, year] = match;
          const monthIndex = months[monthName.toLowerCase()];
          if (monthIndex !== undefined) {
            return new Date(parseInt(year), monthIndex, parseInt(day));
          }
        } else if (regex.source.includes('\\/')) {
          const [, day, month, year] = match;
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          const [, year, month, day] = match;
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
      }
    }

    return null;
  }

  private extractTime(text: string): string | null {
    const timeMatch = text.match(/(\d{1,2})[h:](\d{2})/);
    if (timeMatch) {
      const [, hour, minute] = timeMatch;
      return `${hour.padStart(2, '0')}:${minute}`;
    }
    return null;
  }
}
