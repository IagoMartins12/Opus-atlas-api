import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';

export interface ScraperConfig {
  venueName: string;
  venueSlug: string;
  baseUrl: string;
  userAgent?: string;
  delayBetweenRequests?: number;
}

export interface ScraperState {
  eventsFound: number;
  eventsScraped: number;
  errors: string[];
  startTime: number;
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

  // Métodos abstratos que DEVEM ser implementados pelas classes filhas
  abstract scrapeEvents(): Promise<ScrapedEvent[]>;

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
      } catch (error: any) {
        console.error(
          `❌ Error fetching ${url} (attempt ${i + 1}/${retries}):`,
          error.message,
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
  protected logError(error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.state.errors.push(errorMessage);
    console.error(`[${this.config.venueName}] ❌ ${errorMessage}`);
  }

  // Retorna o estado atual
  getState(): ScraperState {
    return this.state;
  }
}
