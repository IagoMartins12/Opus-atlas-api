// theatro-da-paz-scraper.service.ts
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
export class TheatroDaPazScraperService extends BaseScraper {
  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Theatro da Paz',
      venueSlug: 'theatro-da-paz',
      baseUrl: 'https://secult.pa.gov.br',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      delayBetweenRequests: 2000,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      onProgress?.(0, 100, 'Iniciando scraper Theatro da Paz...');

      const html = await this.fetchWithRetry(
        `${this.config.baseUrl}/theatro-da-paz`,
      );
      const $ = cheerio.load(html);

      const events: ScrapedEvent[] = [];

      // Buscar eventos e notícias relacionadas
      $('.post, .evento, .noticia, article').each((index, element) => {
        const $elem = $(element);

        const title = $elem
          .find('h1, h2, h3, .entry-title, .titulo')
          .first()
          .text()
          .trim();
        const content = $elem.find('.entry-content, .content, p').text();
        const imageUrl = $elem.find('img').first().attr('src') || null;
        const linkUrl = $elem.find('a').first().attr('href') || null;

        // Filtrar apenas eventos de música clássica
        const textLower = `${title} ${content}`.toLowerCase();
        const isMusicEvent =
          textLower.includes('orquestra') ||
          textLower.includes('concerto') ||
          textLower.includes('sinfônica') ||
          textLower.includes('recital') ||
          textLower.includes('beethoven') ||
          textLower.includes('mozart') ||
          textLower.includes('clássica');

        if (!isMusicEvent || !title) return;

        // Extrair data do conteúdo
        const dateMatch = content.match(
          /(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
        );
        if (!dateMatch) return;

        const startDate = this.parseDateFromMatch(dateMatch);
        if (!startDate) return;

        // Extrair horário
        const timeMatch = content.match(/(\d{1,2})h(\d{2})?|(\d{1,2}):(\d{2})/);
        let startTime = '20:00';
        if (timeMatch) {
          const hour = timeMatch[1] || timeMatch[3];
          const minute = timeMatch[2] || timeMatch[4] || '00';
          startTime = `${hour.padStart(2, '0')}:${minute}`;
        }

        const eventType = detectEventType(title, content);
        const composerNames = extractComposerNames(`${title} ${content}`);

        // Detectar informações de ingresso
        let ticketInfo: string | null = null;
        if (
          textLower.includes('gratuito') ||
          textLower.includes('grátis') ||
          textLower.includes('entrada franca')
        ) {
          ticketInfo = 'Entrada gratuita';
        } else if (textLower.includes('r$')) {
          const priceMatch = content.match(/r\$\s*(\d+)/i);
          if (priceMatch) ticketInfo = `Ingressos: R$ ${priceMatch[1]}`;
        }

        const externalId = `theatro-da-paz-${createSlug(title)}-${startDate.getTime()}`;

        events.push({
          title,
          slug: createSlug(`${title}-${startDate.toISOString()}`),
          description: content.substring(0, 500).trim() || title,
          type: eventType,
          startDate,
          startTime,
          endDate: null,
          endTime: null,
          venueDetails: 'Theatro da Paz',
          ticketUrl: linkUrl || null,
          externalUrl: linkUrl || null,
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

  private parseDateFromMatch(match: RegExpMatchArray): Date | null {
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

    if (match[1] && match[2]) {
      // Formato: "28 de novembro de 2025"
      const day = parseInt(match[1]);
      const monthName = match[2].toLowerCase();
      const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
      const monthIndex = months[monthName];

      if (monthIndex !== undefined) {
        return new Date(year, monthIndex, day);
      }
    } else if (match[4] && match[5] && match[6]) {
      // Formato: "28/11/2025"
      return new Date(
        parseInt(match[6]),
        parseInt(match[5]) - 1,
        parseInt(match[4]),
      );
    }

    return null;
  }
}
