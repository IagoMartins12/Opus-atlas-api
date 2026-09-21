import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import {
  detectEventType,
  extractComposerNames,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';
import { errorMessage } from '../../common/utils/error.util';
import { extractSessions, extractSummary } from './theatro-municipal.parser';

/** Quantas páginas de evento são buscadas ao mesmo tempo. */
const CONCURRENCY = 5;

/** Onde a casa publica o que está em cartaz. */
const PROGRAM_PATH = '/programacao/';

/**
 * Programação do Theatro Municipal de São Paulo.
 *
 * **O Puppeteer saiu, e com ele dez minutos de execução.** A versão anterior
 * abria um navegador de verdade, e uma aba nova para cada evento, em série.
 * Medido contra o sítio real: **613 segundos** para 22 eventos, dos quais dez
 * falharam com `ConnectionClosedError` — o navegador não aguenta abrir e fechar
 * dezenas de abas seguidas. Resultado: 12 eventos em dez minutos, com metade
 * das falhas invisíveis no relatório.
 *
 * Nada disso era necessário: **a data está no HTML servido** de cada página de
 * evento, sob o rótulo "Datas Disponíveis". A listagem sai de `/programacao/` e
 * cada página é uma requisição HTTP comum, cinco de cada vez.
 *
 * **A listagem não vem da API do WordPress, e isso é deliberado.** O sítio
 * expõe `wp-json/wp/v2/eventos`, mas ali estão **2.239 eventos** — o arquivo
 * inteiro, de temporadas passadas incluídas —, e a API não publica a data do
 * evento (ela vive em campo do JetEngine, fora do REST). Descobrir quais dos
 * 2.239 ainda vão acontecer exigiria baixar as 2.239 páginas. `/programacao/`
 * é a própria casa dizendo o que está em cartaz.
 *
 * Um evento pode ter **várias sessões** ("Ópera Don Carlo, Sessão 1 e 2"), e
 * cada uma vira um registro próprio: é assim que ela aparece no calendário de
 * quem vai assistir.
 */
@Injectable()
export class TheatroMunicipalScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Theatro Municipal de São Paulo',
      venueSlug: 'theatro-municipal',
      venue: {
        address: 'Praça Ramos de Azevedo, s/n - República',
        city: 'São Paulo',
        state: 'SP',
        country: 'Brasil',
        zipCode: '01037-010',
      },
      baseUrl: 'https://theatromunicipal.org.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 0,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    onProgress?.(0, 100, 'Lendo a lista de eventos do Theatro Municipal...');

    const listed = await this.listEvents();

    this.state.eventsFound = listed.length;

    onProgress?.(10, 100, `${listed.length} eventos publicados`);

    const events: ScrapedEvent[] = [];

    // Cinco de cada vez: o suficiente para não levar dez minutos, e pouco o
    // bastante para não parecer ataque a um sítio público.
    for (let start = 0; start < listed.length; start += CONCURRENCY) {
      const batch = listed.slice(start, start + CONCURRENCY);

      const results = await Promise.all(
        batch.map((url) => this.scrapeOne(url)),
      );

      events.push(...results.flat());

      onProgress?.(
        Math.round(10 + (80 * (start + batch.length)) / listed.length),
        100,
        `${events.length} sessões coletadas`,
      );
    }

    this.state.eventsScraped = events.length;

    onProgress?.(100, 100, `${events.length} sessões coletadas`);

    return events;
  }

  /** Os endereços dos eventos em cartaz, da página de programação. */
  private async listEvents(): Promise<string[]> {
    const response = await this.httpClient.get<string>(PROGRAM_PATH);
    const $ = cheerio.load(response.data);

    const links = new Set<string>();

    $('a[href*="/eventos/"]').each((_: number, element: unknown) => {
      const href = $(element as never).attr('href');

      if (href && /\/eventos\/[a-z0-9-]+\/?$/i.test(href)) {
        links.add(
          href.startsWith('http') ? href : `${this.config.baseUrl}${href}`,
        );
      }
    });

    return [...links];
  }

  /** As sessões de um evento — uma requisição, sem navegador. */
  private async scrapeOne(url: string): Promise<ScrapedEvent[]> {
    try {
      const response = await this.httpClient.get<string>(url, {
        baseURL: undefined,
      });

      const $ = cheerio.load(response.data);
      const title = decodeEntities($('h1').first().text()).trim();

      if (!title) {
        this.state.errors.push(`Evento sem título: ${url}`);

        return [];
      }

      const sessions = extractSessions($);

      if (sessions.length === 0) {
        // Sem data o registro não serve a um calendário; fica registrado para
        // quem confere, em vez de sumir.
        this.state.errors.push(`"${title}": nenhuma data na página`);

        return [];
      }

      const description = extractSummary($);

      return sessions.map((session, index) => ({
        title: sessions.length > 1 ? `${title} (Sessão ${index + 1})` : title,
        slug: createSlug(
          sessions.length > 1 ? `${title}-sessao-${index + 1}` : title,
        ),
        description,
        type: detectEventType(title, description),
        startDate: session.startDate,
        startTime: session.startTime,
        venueDetails: this.config.venueName,
        ticketUrl: url,
        externalUrl: url,
        ticketInfo: null,
        // O caminho da página mais o número da sessão: estável mesmo quando o
        // título muda.
        externalId: `theatro-municipal-${slugOf(url)}-${index}`,
        imageUrl: null,
        composerNames: extractComposerNames(`${title} ${description}`),
        performers: [],
        program: null,
      }));
    } catch (error: unknown) {
      this.state.errors.push(`${url}: ${errorMessage(error)}`);

      return [];
    }
  }
}

function slugOf(url: string): string {
  return url.replace(/\/$/, '').split('/').pop() ?? url;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}
