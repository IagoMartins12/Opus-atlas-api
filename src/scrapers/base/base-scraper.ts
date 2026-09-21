// base-scraper.ts
import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import { errorMessage } from '../../common/utils/error.util';

/**
 * Onde a casa fica.
 *
 * **Mora aqui, junto do scraper, e não numa tabela do importador.** O
 * `ImportService` tinha um mapa próprio de casas — com **duas das sete** — e a
 * falta estourava antes do laço: importar a programação da Sala Cecília
 * Meireles, do Theatro da Paz ou da Cidade das Artes falhava inteira, com
 * "Venue não configurado". Eram duas listas que precisavam concordar e não
 * concordavam. Agora é uma: quem declara o scraper declara a casa, e o
 * compilador cobra.
 */
export interface VenueLocation {
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  /** Nome curto, quando a casa tem um pelo qual é conhecida. */
  shortName?: string;
}

export interface ScraperConfig {
  venueName: string;
  venueSlug: string;
  baseUrl: string;
  venue: VenueLocation;
  userAgent?: string;
  delayBetweenRequests?: number;
}

export interface ScraperState {
  eventsFound: number;
  eventsScraped: number;
  errors: string[];
  startTime: number;
}

export interface ScraperResponse {
  success: boolean;
  eventsFound: number;
  eventsScraped: number;
  newEvents: number;
  duplicates: number;
  events?: ScrapedEvent[];
  errors: string[];
  executionTime: number;
}

@Injectable()
export abstract class BaseScraper {
  protected config: ScraperConfig;
  protected httpClient: AxiosInstance;
  protected state: ScraperState;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'User-Agent':
          config.userAgent ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 30000,
    });

    this.state = {
      eventsFound: 0,
      eventsScraped: 0,
      errors: [],
      startTime: Date.now(),
    };
  }

  public getConfig(): ScraperConfig {
    return this.config;
  }

  /**
   * Zera o estado da rodada.
   *
   * O scraper é um singleton do Nest: o mesmo objeto atende todas as rodadas,
   * e `this.state` guarda contadores e a lista de erros. Sem zerar entre uma
   * rodada e outra, os erros de ontem aparecem no relatório de hoje.
   */
  public resetState(): void {
    this.state = {
      eventsFound: 0,
      eventsScraped: 0,
      errors: [],
      startTime: Date.now(),
    };
  }

  // Métodos abstratos que DEVEM ser implementados pelas classes filhas
  abstract scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]>;

  /**
   * ✅ DELAY - Aguarda um tempo antes de fazer próxima requisição
   */
  protected async delay(ms?: number): Promise<void> {
    const delayTime = ms ?? this.config.delayBetweenRequests ?? 2000;
    return new Promise((resolve) => setTimeout(resolve, delayTime));
  }

  /**
   * ✅ FETCH WITH RETRY - Faz requisição HTTP com retry automático
   */
  protected async fetchWithRetry(url: string, retries = 3): Promise<string> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await this.httpClient.get(url);
        return response.data;
      } catch (error: unknown) {
        console.error(
          `❌ Error fetching ${url} (attempt ${i + 1}/${retries}):`,
          errorMessage(error),
        );

        if (i < retries - 1) {
          await this.delay(3000 * (i + 1)); // Exponential backoff
        } else {
          throw error;
        }
      }
    }

    throw new Error('Max retries exceeded');
  }

  // Log helper
  protected log(message: string): void {
    console.log(`[${this.config.venueName}] ${message}`);
  }

  // Error handling
  protected logError(error: unknown): void {
    const message = errorMessage(error);
    this.state.errors.push(message);
    console.error(`[${this.config.venueName}] ❌ ${message}`);
  }

  // Retorna o estado atual
  getState(): ScraperState {
    return this.state;
  }
}
