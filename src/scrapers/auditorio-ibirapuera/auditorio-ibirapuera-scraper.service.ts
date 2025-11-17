// auditorio-ibirapuera-scraper.service.ts
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
export class AuditorioIbirapueraScraperService extends BaseScraper {
  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Auditório Ibirapuera',
      venueSlug: 'auditorio-ibirapuera',
      baseUrl: 'https://auditorioibirapuera.com.br',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      onProgress?.(0, 100, 'Iniciando scraper Auditório Ibirapuera...');

      const html = await this.fetchWithRetry(
        `${this.config.baseUrl}/programacao`,
      );
      const $ = cheerio.load(html);

      const events: ScrapedEvent[] = [];

      $('.evento, .show, .programacao-item, article').each((index, element) => {
        const $elem = $(element);

        const title = $elem
          .find('h2, h3, .titulo, .event-title')
          .first()
          .text()
          .trim();
        const dateText = $elem.find('.data, .date, time').first().text().trim();
        const timeText = $elem.find('.horario, .time').first().text().trim();
        const description = $elem
          .find('p, .descricao, .sinopse')
          .first()
          .text()
          .trim();
        const imageUrl = $elem.find('img').first().attr('src') || null;
        const linkUrl = $elem.find('a').first().attr('href') || null;

        // Filtrar eventos de música clássica
        const textContent = `${title} ${description}`.toLowerCase();
        const isClassicalMusic =
          textContent.includes('orquestra') ||
          textContent.includes('sinfônica') ||
          textContent.includes('concerto') ||
          textContent.includes('recital') ||
          textContent.includes('câmara') ||
          textContent.includes('clássica') ||
          textContent.includes('erudita');

        if (!isClassicalMusic || !title || !dateText) return;

        const startDate = this.parseDate(dateText);
        if (!startDate) return;

        const startTime = this.parseTime(timeText) || '20:00';
        const eventType = detectEventType(title, description);
        const composerNames = extractComposerNames(`${title} ${description}`);

        // Informações de ingresso
        let ticketInfo: string | null = null;
        let ticketUrl: string | null = null;

        if (
          textContent.includes('gratuito') ||
          textContent.includes('grátis')
        ) {
          ticketInfo = 'Entrada gratuita';
        }

        const ticketLink = $elem
          .find('a[href*="ingresso"], a[href*="ticket"]')
          .attr('href');
        if (ticketLink) {
          ticketUrl = ticketLink.startsWith('http')
            ? ticketLink
            : `${this.config.baseUrl}${ticketLink}`;
        }

        const externalId = `auditorio-ibirapuera-${createSlug(title)}-${startDate.getTime()}`;

        events.push({
          title,
          slug: createSlug(`${title}-${startDate.toISOString()}`),
          description: description || title,
          type: eventType,
          startDate,
          startTime,
          endDate: null,
          endTime: null,
          venueDetails: 'Auditório Ibirapuera',
          ticketUrl:
            ticketUrl || (linkUrl ? `${this.config.baseUrl}${linkUrl}` : null),
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
      });

      onProgress?.(100, 100, 'Scraper concluído!');
      this.log(`✅ ${events.length} eventos coletados`);

      return events;
    } catch (error) {
      this.logError(error);
      throw error;
    }
  }

  private parseDate(text: string): Date | null {
    const formats = [
      /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
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
        if (match[2] && isNaN(Number(match[2]))) {
          const monthIndex = months[match[2].toLowerCase()];
          if (monthIndex !== undefined) {
            return new Date(parseInt(match[3]), monthIndex, parseInt(match[1]));
          }
        } else if (match[1] && match[2] && match[3]) {
          return new Date(
            parseInt(match[3]),
            parseInt(match[2]) - 1,
            parseInt(match[1]),
          );
        }
      }
    }

    return null;
  }

  private parseTime(text: string): string | null {
    const timeMatch = text.match(/(\d{1,2})[h:](\d{2})/);
    if (timeMatch) {
      const [, hour, minute] = timeMatch;
      return `${hour.padStart(2, '0')}:${minute}`;
    }
    return null;
  }
}
