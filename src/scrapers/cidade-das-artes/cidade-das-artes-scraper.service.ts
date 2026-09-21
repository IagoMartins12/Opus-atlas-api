import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import {
  detectEventType,
  extractComposerNames,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';

/** "15/07 a 04/10" ou "19/09" — a listagem escreve sem o ano. */
const DATE_RANGE = /(\d{2})\/(\d{2})(?:\s*a\s*(\d{2})\/(\d{2}))?/;

/**
 * Programação da Cidade das Artes.
 *
 * **O endereço configurado não tinha certificado válido.** `cidadedasartes.rio`
 * responde com um certificado emitido para `*.apps.rio.gov.br`, e a requisição
 * morria antes de sair — `Hostname/IP does not match certificate's altnames`.
 * O nome que a prefeitura publica com certificado próprio é
 * `cidadedasartes.rio.rj.gov.br`, e é para ele que `cidadedasartes.rio`
 * redireciona.
 *
 * **A listagem não traz o ano.** Ela escreve "15/07 a 04/10", e é a temporada
 * corrente. Um dia e mês já passados neste ano pertencem ao ano que vem — sem
 * essa correção, o evento de janeiro entraria como onze meses no passado e
 * sumiria de qualquer consulta de programação futura.
 */
@Injectable()
export class CidadeDasArtesScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Cidade das Artes',
      venueSlug: 'cidade-das-artes',
      venue: {
        address: 'Av. das Américas, 5300 - Barra da Tijuca',
        city: 'Rio de Janeiro',
        state: 'RJ',
        country: 'Brasil',
        zipCode: '22640-102',
      },
      baseUrl: 'https://cidadedasartes.rio.rj.gov.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    onProgress?.(0, 100, 'Lendo a programação da Cidade das Artes...');

    const html = await this.fetchWithRetry(`${this.config.baseUrl}/`);
    const $ = cheerio.load(html);

    const boxes = $('.box_evento');

    onProgress?.(50, 100, `${boxes.length} eventos na página`);

    const events = new Map<string, ScrapedEvent>();

    boxes.each((_, element) => {
      const box = $(element);
      const url = box.attr('href');

      if (!url || events.has(url)) {
        return;
      }

      const title = box.find('.titulo').first().text().trim();
      const dateText = box.find('.data').first().text().trim();
      const category = box.find('.categoria').first().text().trim();
      const description = box.find('.texto').first().text().trim();

      if (!title) {
        this.state.errors.push(`Evento sem título: ${url}`);

        return;
      }

      const dates = parseSeasonRange(dateText, new Date());

      if (!dates) {
        this.state.errors.push(`Data ilegível em "${title}": "${dateText}"`);

        return;
      }

      events.set(url, {
        title,
        slug: createSlug(title),
        description,
        type: detectEventType(`${title} ${category}`, description),
        startDate: dates.startDate,
        startTime: null,
        endDate: dates.endDate,
        venueDetails: this.config.venueName,
        ticketUrl: url,
        externalUrl: url,
        ticketInfo: null,
        // A listagem numera o evento no próprio endereço.
        externalId: `cidade-das-artes-${url.split('/').pop() ?? createSlug(title)}`,
        imageUrl: box.find('img').first().attr('src') ?? null,
        composerNames: extractComposerNames(`${title} ${description}`),
        performers: [],
        program: null,
      });
    });

    this.state.eventsFound = boxes.length;
    this.state.eventsScraped = events.size;

    onProgress?.(100, 100, `${events.size} eventos coletados`);

    return [...events.values()];
  }
}

/**
 * Converte "15/07 a 04/10" — sem ano — em datas.
 *
 * O ano é o corrente, salvo quando o dia e o mês já passaram: aí é o próximo. A
 * folga de um dia evita que o evento de hoje seja jogado para o ano que vem.
 */
export function parseSeasonRange(
  text: string,
  now: Date,
): { startDate: Date; endDate: Date | null } | null {
  const match = text.match(DATE_RANGE);

  if (!match) {
    return null;
  }

  const [, startDay, startMonth, endDay, endMonth] = match;

  if (!endDay || !endMonth) {
    const startDate = withSeasonYear(startDay, startMonth, now);

    return startDate ? { startDate, endDate: null } : null;
  }

  // **Numa temporada em cartaz, o começo já passou — e continua sendo deste
  // ano.** "15/07 a 04/10" lido em setembro: jogar o início para o ano que vem
  // porque 15/07 passou põe o espetáculo doze meses no futuro enquanto ele
  // está em cartaz agora. Quem manda é o fim: se ele ainda não chegou, a
  // temporada é a corrente.
  const endDate = withSeasonYear(endDay, endMonth, now);

  if (!endDate) {
    return null;
  }

  const startDate = thisYear(startDay, startMonth);

  if (!startDate) {
    return null;
  }

  // Temporada que vira o ano: "15/12 a 04/01" começa no ano anterior ao fim.
  if (startDate > endDate) {
    startDate.setFullYear(startDate.getFullYear() - 1);
  }

  return { startDate, endDate };
}

function thisYear(day: string, month: string): Date | null {
  const dayNumber = Number(day);
  const monthNumber = Number(month);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }

  const candidate = new Date(
    new Date().getFullYear(),
    monthNumber - 1,
    dayNumber,
  );

  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function withSeasonYear(day: string, month: string, now: Date): Date | null {
  const dayNumber = Number(day);
  const monthNumber = Number(month);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }

  const candidate = new Date(
    now.getFullYear(),
    monthNumber - 1,
    dayNumber,
    0,
    0,
    0,
    0,
  );

  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (candidate < yesterday) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }

  return candidate;
}
