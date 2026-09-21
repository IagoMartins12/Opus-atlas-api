import { Injectable } from '@nestjs/common';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import {
  detectEventType,
  extractComposerNames,
} from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';
import { errorMessage } from '../../common/utils/error.util';

/** Um item da agenda, como a API da secretaria o devolve. */
interface Pauta {
  id?: string | number;
  title?: string;
  nome?: string;
  descricao?: string;
  description?: string;
  local?: string;
  category?: string;
  data?: string;
  date?: string;
  data_inicio?: string;
  hora?: string;
}

/**
 * A API de agenda que a página da secretaria consulta.
 *
 * O endereço está escrito no próprio JavaScript da página `/agenda/`:
 *
 * ```js
 * url: 'https://sistemas.cultura.am.gov.br/sigec/api/ListarPautas?type=year&val1=2023'
 * ```
 */
const AGENDA_API = 'https://sistemas.cultura.am.gov.br/sigec/api/ListarPautas';

/**
 * Programação do Teatro Amazonas.
 *
 * **A fonte desta casa está fora do ar, e não é a página que quebrou — é o
 * servidor de dados por trás dela.** O scraper pedia
 * `cultura.am.gov.br/teatro-amazonas/programacao`, que responde 404; a agenda
 * mudou para `/agenda/`, e essa página **não traz evento nenhum no HTML**: ela
 * carrega tudo por uma chamada a `sistemas.cultura.am.gov.br`, cujo nome
 * **não resolve mais em DNS**. Ou seja, a própria agenda da secretaria abre
 * vazia num navegador comum.
 *
 * Além disso, a página pede o ano **2023** fixo no código, o que já indica
 * abandono.
 *
 * O scraper continua aqui, apontado para a API certa e pedindo o ano corrente:
 * no dia em que o servidor voltar, ele volta junto. Enquanto não voltar, ele
 * **falha dizendo por quê** em vez de devolver zero eventos em silêncio —
 * "nenhum evento" e "a fonte sumiu" não podem chegar iguais a quem opera.
 */
@Injectable()
export class TeatroAmazonasScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Teatro Amazonas',
      venueSlug: 'teatro-amazonas',
      venue: {
        address: 'Largo de São Sebastião, s/n - Centro',
        city: 'Manaus',
        state: 'AM',
        country: 'Brasil',
        zipCode: '69010-140',
      },
      baseUrl: 'https://cultura.am.gov.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 2000,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    const year = new Date().getFullYear();

    onProgress?.(0, 100, `Lendo a agenda de ${year} do Teatro Amazonas...`);

    let pautas: Pauta[];

    try {
      const response = await this.httpClient.get(
        `${AGENDA_API}?type=year&val1=${year}&format=json`,
        { baseURL: undefined },
      );

      pautas = normalizePautas(response.data);
    } catch (error: unknown) {
      throw new Error(
        `A agenda do Teatro Amazonas não respondeu (${AGENDA_API}): ` +
          `${errorMessage(error)}. A página /agenda/ da secretaria carrega os ` +
          'eventos desse endereço, e ele está fora do ar — a agenda abre vazia ' +
          'também no navegador.',
      );
    }

    onProgress?.(60, 100, `${pautas.length} itens na agenda`);

    const events = pautas.flatMap((pauta) => {
      const event = this.toEvent(pauta);

      return event ? [event] : [];
    });

    this.state.eventsFound = pautas.length;
    this.state.eventsScraped = events.length;

    onProgress?.(100, 100, `${events.length} eventos coletados`);

    return events;
  }

  private toEvent(pauta: Pauta): ScrapedEvent | null {
    const title = (pauta.title ?? pauta.nome ?? '').trim();
    const rawDate = pauta.data_inicio ?? pauta.data ?? pauta.date;

    if (!title || !rawDate) {
      this.state.errors.push(
        `Item sem título ou sem data: ${title || pauta.id || 'desconhecido'}`,
      );

      return null;
    }

    const startDate = new Date(rawDate);

    if (Number.isNaN(startDate.getTime())) {
      this.state.errors.push(`Data ilegível em "${title}": ${rawDate}`);

      return null;
    }

    const description = (pauta.descricao ?? pauta.description ?? '').trim();

    return {
      title,
      slug: createSlug(title),
      description,
      type: detectEventType(`${title} ${pauta.category ?? ''}`, description),
      startDate,
      startTime: pauta.hora ?? null,
      venueDetails: pauta.local ?? this.config.venueName,
      ticketUrl: null,
      externalUrl: `${this.config.baseUrl}/agenda/`,
      ticketInfo: null,
      externalId: `teatro-amazonas-${pauta.id ?? createSlug(title)}`,
      imageUrl: null,
      composerNames: extractComposerNames(`${title} ${description}`),
      performers: [],
      program: null,
    };
  }
}

/** A API pode devolver vetor ou mapa; as duas formas viram lista. */
export function normalizePautas(data: unknown): Pauta[] {
  if (Array.isArray(data)) {
    return data as Pauta[];
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const pautas = record.pautas ?? record.data ?? record;

    if (Array.isArray(pautas)) {
      return pautas as Pauta[];
    }

    if (pautas && typeof pautas === 'object') {
      return Object.values(pautas as Record<string, Pauta>);
    }
  }

  return [];
}
