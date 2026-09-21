import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import {
  detectEventType,
  extractComposerNames,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';
import { CheerioDocument } from '../imslp/imslp-work.parser';

/** O tipo de um nó selecionado, sem depender dos tipos antigos do cheerio. */
type CheerioNode = ReturnType<CheerioDocument>;

/** A listagem repete cada evento por causa do layout responsivo. */
const ISO_DATETIME = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

/**
 * Programação da Sala Cecília Meireles.
 *
 * **O domínio que estava configurado não é mais da casa.**
 * `salaceciliameireles.com.br` foi solto e hoje serve um site de apostas —
 * a página inicial fala de bônus de boas-vindas, saques e cassino. O scraper
 * pedia `/programacao` ali e recebia 404; se um dia aquele endereço
 * respondesse 200, o que entraria no catálogo de concertos seria conteúdo de
 * casa de apostas. A casa é órgão do estado do Rio e vive em
 * `salaceciliameireles.rj.gov.br`.
 *
 * **A programação vem da página inicial, não de `/programacao-2/`.** A página
 * de programação lista o acervo a partir de 2018; é a inicial que traz os
 * próximos concertos. Cada item da grade carrega a data em formato ISO num
 * campo oculto, o que dispensa interpretar "sex, 11 set".
 */
@Injectable()
export class SalaCeciliaMeirelesScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Sala Cecília Meireles',
      venueSlug: 'sala-cecilia-meireles',
      venue: {
        address: 'Largo da Lapa, 47 - Centro',
        city: 'Rio de Janeiro',
        state: 'RJ',
        country: 'Brasil',
        zipCode: '20021-180',
      },
      baseUrl: 'https://salaceciliameireles.rj.gov.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    onProgress?.(0, 100, 'Lendo a programação da Sala Cecília Meireles...');

    const html = await this.fetchWithRetry(`${this.config.baseUrl}/`);
    const $ = cheerio.load(html);

    const items = $('.jet-listing-grid__item');

    onProgress?.(40, 100, `${items.length} blocos na grade`);

    // A mesma grade é renderizada três vezes (desktop, tablet, celular): a
    // chave é o endereço do evento, e o mapa resolve sem depender da ordem.
    const events = new Map<string, ScrapedEvent>();

    items.each((_, element) => {
      const item = $(element);

      // O `<style>` embutido em cada item entraria no texto e engoliria a data.
      item.find('style').remove();

      const url = item.find('a[href*="/programacao/"]').first().attr('href');

      if (!url || events.has(url)) {
        return;
      }

      const event = this.toEvent(item, url, $);

      if (event) {
        events.set(url, event);
      }
    });

    this.state.eventsFound = events.size;
    this.state.eventsScraped = events.size;

    onProgress?.(100, 100, `${events.size} eventos coletados`);

    return [...events.values()];
  }

  private toEvent(
    item: CheerioNode,
    url: string,
    $: CheerioDocument,
  ): ScrapedEvent | null {
    const headings = item
      .find('.elementor-heading-title')
      .map((_: number, heading: unknown) =>
        $(heading as never)
          .text()
          .trim(),
      )
      .get()
      .filter(Boolean);

    const dateIndex = headings.findIndex((text) => ISO_DATETIME.test(text));
    const isoDate = dateIndex >= 0 ? headings[dateIndex] : null;
    const startDate = isoDate ? new Date(isoDate.replace(' ', 'T')) : null;

    // Sem data não há evento: o calendário é a razão de o registro existir.
    if (!startDate || Number.isNaN(startDate.getTime())) {
      this.state.errors.push(`Evento sem data legível: ${url}`);

      return null;
    }

    // **O título é o cabeçalho logo depois da data**, e a posição importa: o
    // primeiro cabeçalho do bloco é o nome da *série* ("Série Sala
    // Orquestras"), não o do concerto. Pegar o primeiro que não fosse data,
    // sala ou preço trazia a série para todos os eventos, e três concertos
    // diferentes viravam três registros com o nome da temporada.
    const title = headings
      .slice(dateIndex + 1)
      .find(
        (text) =>
          !text.startsWith('•') && !/^R\$/.test(text) && text.length > 3,
      );

    const series = dateIndex > 0 ? headings[0] : null;

    if (!title) {
      this.state.errors.push(`Evento sem título: ${url}`);

      return null;
    }

    const text = item.text().replace(/\s+/g, ' ').trim();
    const room = headings.find((value) => value.startsWith('•'));
    const price = headings.find((value) => /^R\$/.test(value));

    return {
      title,
      slug: createSlug(title),
      description: text.slice(0, 500),
      type: detectEventType(title, text),
      startDate,
      startTime: isoDate ? isoDate.slice(11, 16) : null,
      venueDetails: room ? room.replace(/^•\s*/, '') : this.config.venueName,
      ticketUrl: url,
      externalUrl: url,
      ticketInfo: price ?? null,
      // O caminho do evento é estável e único na casa.
      externalId: `sala-cecilia-meireles-${url.split('/programacao/')[1]?.replace(/\/$/, '') ?? createSlug(title)}`,
      imageUrl: null,
      composerNames: extractComposerNames(`${title} ${text}`),
      performers: [],
      program: series,
    };
  }
}
