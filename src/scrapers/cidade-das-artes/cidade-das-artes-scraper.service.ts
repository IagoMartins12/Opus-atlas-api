// cidade-das-artes-scraper.service.ts
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
export class CidadeDasArtesScraperService extends BaseScraper {
  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Cidade das Artes',
      venueSlug: 'cidade-das-artes',
      baseUrl: 'https://cidadedasartes.rio',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      delayBetweenRequests: 1800,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      onProgress?.(0, 100, 'Iniciando scraper Cidade das Artes...');

      const html = await this.fetchWithRetry(
        `${this.config.baseUrl}/programacao`,
      );
      const $ = cheerio.load(html);

      const events: ScrapedEvent[] = [];

      $('.evento-card, .event, .show-item, article').each((index, element) => {
        const $elem = $(element);

        const title = $elem
          .find('h2, h3, .title, .event-title')
          .first()
          .text()
          .trim();
        const dateText = $elem.find('.date, .data, time').first().text().trim();
        const timeText = $elem.find('.time, .horario').first().text().trim();
        const description = $elem
          .find('.description, .sinopse, p')
          .first()
          .text()
          .trim();
        const imageUrl = $elem.find('img').first().attr('src') || null;
        const linkUrl = $elem.find('a').first().attr('href') || null;
        const categoryText = $elem
          .find('.category, .genero')
          .text()
          .toLowerCase();

        // Filtrar eventos de música clássica
        const fullText =
          `${title} ${description} ${categoryText}`.toLowerCase();
        const isClassicalMusic =
          fullText.includes('orquestra sinfônica brasileira') ||
          fullText.includes('osb') ||
          fullText.includes('concerto') ||
          fullText.includes('sinfônico') ||
          fullText.includes('clássica') ||
          fullText.includes('música erudita') ||
          fullText.includes('recital') ||
          fullText.includes('câmara');

        if (!isClassicalMusic || !title || !dateText) return;

        const startDate = this.parseDateText(dateText);
        if (!startDate) return;

        const startTime = this.extractTime(timeText) || '20:00';
        const eventType = detectEventType(title, description);
        const composerNames = extractComposerNames(`${title} ${description}`);

        // Informações de ingresso
        let ticketInfo: string | null = null;
        if (fullText.includes('gratuito') || fullText.includes('grátis')) {
          ticketInfo = 'Entrada gratuita';
        } else if (fullText.includes('r$')) {
          const priceMatch = fullText.match(/r\$\s*(\d+)/);
          if (priceMatch) ticketInfo = `A partir de R$ ${priceMatch[1]}`;
        }

        const externalId = `cidade-das-artes-${createSlug(title)}-${startDate.getTime()}`;

        events.push({
          title,
          slug: createSlug(`${title}-${startDate.toISOString()}`),
          description: description || title,
          type: eventType,
          startDate,
          startTime,
          endDate: null,
          endTime: null,
          venueDetails: 'Cidade das Artes - Sala Sinfônica',
          ticketUrl: linkUrl
            ? linkUrl.startsWith('http')
              ? linkUrl
              : `${this.config.baseUrl}${linkUrl}`
            : null,
          externalUrl: linkUrl
            ? linkUrl.startsWith('http')
              ? linkUrl
              : `${this.config.baseUrl}${linkUrl}`
            : null,
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

  private parseDateText(text: string): Date | null {
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
      jan: 0,
      fev: 1,
      mar: 2,
      abr: 3,
      mai: 4,
      jun: 5,
      jul: 6,
      ago: 7,
      set: 8,
      out: 9,
      nov: 10,
      dez: 11,
    };

    const formats = [
      /(\d{1,2})\s+de\s+(\w+)\s+(?:de\s+)?(\d{4})/i,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      /(\d{1,2})\s+(\w{3})\s+(\d{4})/i,
    ];

    for (const regex of formats) {
      const match = text.match(regex);
      if (match) {
        if (match[2] && isNaN(Number(match[2]))) {
          const monthKey = match[2].toLowerCase().substring(0, 3);
          const monthIndex = months[monthKey] ?? months[match[2].toLowerCase()];
          if (monthIndex !== undefined) {
            return new Date(parseInt(match[3]), monthIndex, parseInt(match[1]));
          }
        } else {
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

  private extractTime(text: string): string | null {
    const timeMatch = text.match(/(\d{1,2})[h:](\d{2})/);
    if (timeMatch) {
      const [, hour, minute] = timeMatch;
      return `${hour.padStart(2, '0')}:${minute}`;
    }
    return null;
  }
}
