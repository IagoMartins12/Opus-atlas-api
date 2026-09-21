import { Injectable } from '@nestjs/common';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import {
  detectEventType,
  extractComposerNames,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';

/** Um evento como o Wix o embute na página. */
interface WixEvent {
  id?: string;
  title?: string;
  description?: string;
  about?: string;
  slug?: string;
  location?: { name?: string; formattedAddress?: string };
  scheduling?: {
    config?: { startDate?: string; endDate?: string };
    startTimeFormatted?: string;
    endTimeFormatted?: string;
  };
}

/**
 * Programação do Theatro da Paz.
 *
 * **O endereço configurado não era o da casa.** O scraper pedia
 * `secult.pa.gov.br/theatro-da-paz` — a secretaria de cultura do Pará, que
 * responde 404 nesse caminho e redireciona a raiz para `/transparencia`. O
 * Theatro tem sítio próprio: `www.theatrodapaz.com.br`.
 *
 * **Os eventos não são lidos do HTML.** O sítio é feito em Wix, e a listagem é
 * montada no navegador: raspar a marcação renderizada exigiria um navegador de
 * verdade e devolveria menos do que já está ali. O Wix embute os dados da
 * própria listagem na página, em `appsWarmupData`, com data de início em ISO
 * e fuso declarado — que é exatamente o que um calendário precisa e o que
 * texto como "10 de setembro de 2026 20:00" obriga a adivinhar.
 */
@Injectable()
export class TheatroDaPazScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Theatro da Paz',
      venueSlug: 'theatro-da-paz',
      venue: {
        // Endereço lido da própria página da casa, no bloco de dados do Wix.
        address: 'Avenida da Paz - Praça da República, s/n - Campina',
        city: 'Belém',
        state: 'PA',
        country: 'Brasil',
        zipCode: '66017-060',
      },
      baseUrl: 'https://www.theatrodapaz.com.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    onProgress?.(0, 100, 'Lendo a programação do Theatro da Paz...');

    const html = await this.fetchWithRetry(
      `${this.config.baseUrl}/programa%C3%A7%C3%A3o`,
    );

    const raw = extractWixEvents(html);

    onProgress?.(60, 100, `${raw.length} eventos na página`);

    const events = raw.flatMap((event) => {
      const parsed = this.toEvent(event);

      return parsed ? [parsed] : [];
    });

    this.state.eventsFound = raw.length;
    this.state.eventsScraped = events.length;

    onProgress?.(100, 100, `${events.length} eventos coletados`);

    return events;
  }

  private toEvent(event: WixEvent): ScrapedEvent | null {
    const title = event.title?.trim();
    const startRaw = event.scheduling?.config?.startDate;

    if (!title || !startRaw) {
      this.state.errors.push(
        `Evento sem título ou sem data: ${title ?? event.id ?? 'desconhecido'}`,
      );

      return null;
    }

    const startDate = new Date(startRaw);

    if (Number.isNaN(startDate.getTime())) {
      this.state.errors.push(`Data ilegível em "${title}": ${startRaw}`);

      return null;
    }

    const endRaw = event.scheduling?.config?.endDate;
    const endDate = endRaw ? new Date(endRaw) : null;
    const description = [event.description, event.about]
      .filter(Boolean)
      .join('\n')
      .trim();

    const slug = event.slug ?? createSlug(title);

    return {
      title,
      slug,
      description,
      type: detectEventType(title, description),
      startDate,
      startTime: event.scheduling?.startTimeFormatted ?? null,
      endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null,
      endTime: event.scheduling?.endTimeFormatted ?? null,
      venueDetails: event.location?.name ?? this.config.venueName,
      ticketUrl: null,
      externalUrl: `${this.config.baseUrl}/event-info/${slug}`,
      ticketInfo: null,
      // O identificador é o do próprio Wix, que não muda quando o título muda.
      externalId: `theatro-da-paz-${event.id ?? slug}`,
      imageUrl: null,
      composerNames: extractComposerNames(`${title} ${description}`),
      performers: [],
      program: null,
    };
  }
}

/**
 * Os eventos embutidos na página do Wix.
 *
 * O bloco vem dentro de um JSON grande e escapado; em vez de tentar decodificar
 * a página inteira, recorta-se o vetor `"events":[ ... ]` e o decodifica
 * sozinho. Uma página sem o bloco devolve lista vazia — é o caso de a casa não
 * ter programação publicada, não um erro.
 */
export function extractWixEvents(html: string): WixEvent[] {
  const start = html.indexOf('"events":[{');

  if (start < 0) {
    return [];
  }

  const arrayStart = html.indexOf('[', start);
  const arrayEnd = matchingBracket(html, arrayStart);

  if (arrayEnd < 0) {
    return [];
  }

  const slice = html.slice(arrayStart, arrayEnd + 1);

  try {
    // O JSON está escapado uma vez dentro do HTML.
    return JSON.parse(slice.replace(/\\\//g, '/')) as WixEvent[];
  } catch {
    return [];
  }
}

/** O índice do `]` que fecha o `[` em `open`, respeitando texto entre aspas. */
function matchingBracket(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = open; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
