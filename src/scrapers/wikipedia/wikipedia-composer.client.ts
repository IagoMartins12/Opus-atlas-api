import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExternalPageFetcher } from '../imslp/external-page.fetcher';
import { requireSourceUrl } from '../imslp/source-url';
import { WikidataTime } from './wikipedia-composer.parser';

/** O que a Wikipedia devolve sobre um artigo. */
export interface WikipediaArticle {
  pageid: number;
  title: string;
  /** Resumo em texto puro — a introdução do artigo. */
  summary: string | null;
  portraitUrl: string | null;
  /** Identificador do item correspondente no Wikidata (`Q1339`). */
  wikidataId: string | null;
  /** O idioma do artigo, tirado do host. */
  language: string;
  url: string;
}

/** O que o Wikidata devolve sobre a pessoa. */
export interface WikidataPerson {
  birth: WikidataTime | null;
  death: WikidataTime | null;
  /** Rótulo do país de cidadania, no idioma pedido. */
  countryLabel: string | null;
}

/** Propriedades do Wikidata que interessam. */
const P_BIRTH = 'P569';
const P_DEATH = 'P570';
const P_CITIZENSHIP = 'P27';

interface WikipediaQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        missing?: string;
        extract?: string;
        original?: { source?: string };
        pageprops?: { wikibase_item?: string };
      }
    >;
  };
}

interface WikidataEntitiesResponse {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value?: string }>;
      claims?: Record<
        string,
        {
          mainsnak?: {
            datavalue?: { value?: unknown };
          };
        }[]
      >;
    }
  >;
}

/**
 * Lê compositor na Wikipedia e no Wikidata.
 *
 * **O legado extraía tudo de HTML com expressão regular, e a Wikipedia publica
 * API.** As 1.589 linhas da rota `external-sources/scraper` são, em boa parte,
 * tentativas sucessivas de arrancar a data de nascimento da prosa do artigo:
 * primeiro a infobox, depois o primeiro parágrafo com três padrões de
 * parênteses, depois o texto inteiro da página com `/born[^.]*?(\d{1,2}\s+\w+\s+\d{4})/i`.
 * Cada uma quebra num artigo escrito de outro jeito, e nenhuma sabe dizer se
 * achou o ano exato ou um aproximado.
 *
 * O Wikidata devolve a mesma data como dado: com **precisão** declarada — dia,
 * mês, ano ou década — e com o **calendário**. As duas coisas mudam o
 * resultado. A data de nascimento de Bach é 21 de março de 1685 no juliano e 31
 * de março no gregoriano; ler da prosa é ficar com a que o autor do artigo
 * escolheu, sem saber qual.
 */
@Injectable()
export class WikipediaComposerClient {
  private readonly logger = new Logger(WikipediaComposerClient.name);

  constructor(private readonly fetcher: ExternalPageFetcher) {}

  /** O artigo apontado pela URL, resolvendo redirecionamento. */
  async article(rawUrl: string): Promise<WikipediaArticle> {
    const { url } = requireSourceUrl(rawUrl, 'wikipedia');
    const parsed = new URL(url);
    const title = articleTitleOf(parsed);

    if (!title) {
      throw new NotFoundException(
        `O endereço "${url}" não aponta para um artigo da Wikipedia.`,
      );
    }

    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts|pageimages|pageprops',
      // Só a introdução, em texto puro: é ela que vira a biografia.
      exintro: '1',
      explaintext: '1',
      piprop: 'original',
      titles: title,
      // O artigo pode ser um redirecionamento; queremos o destino.
      redirects: '1',
      format: 'json',
    });

    const { data } = await this.fetcher.loadJson<WikipediaQueryResponse>(
      `${parsed.origin}/w/api.php?${params.toString()}`,
      'wikipedia',
    );

    const page = Object.values(data.query?.pages ?? {})[0];

    if (
      !page ||
      page.missing !== undefined ||
      typeof page.pageid !== 'number'
    ) {
      throw new NotFoundException(
        `A Wikipedia não tem o artigo "${decodeURIComponent(title)}".`,
      );
    }

    return {
      pageid: page.pageid,
      title: page.title ?? decodeURIComponent(title),
      summary: page.extract?.trim() || null,
      // A URL da imagem vem com parâmetros de rastreio da própria API.
      portraitUrl: stripQuery(page.original?.source ?? null),
      wikidataId: page.pageprops?.wikibase_item ?? null,
      language: parsed.hostname.split('.')[0],
      url,
    };
  }

  /** Os dados estruturados da pessoa, quando o artigo tem item no Wikidata. */
  async person(wikidataId: string, language: string): Promise<WikidataPerson> {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: wikidataId,
      props: 'claims',
      format: 'json',
    });

    const { data } = await this.fetcher.loadJson<WikidataEntitiesResponse>(
      `https://www.wikidata.org/w/api.php?${params.toString()}`,
      'wikidata',
    );

    const claims = data.entities?.[wikidataId]?.claims ?? {};

    const countryId = entityIdOf(firstValue(claims, P_CITIZENSHIP));

    return {
      birth: timeOf(firstValue(claims, P_BIRTH)),
      death: timeOf(firstValue(claims, P_DEATH)),
      countryLabel: countryId ? await this.label(countryId, language) : null,
    };
  }

  /** O rótulo de um item, no idioma pedido, com o inglês como reserva. */
  private async label(
    entityId: string,
    language: string,
  ): Promise<string | null> {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: entityId,
      props: 'labels',
      languages: `${language}|en`,
      format: 'json',
    });

    const { data } = await this.fetcher.loadJson<WikidataEntitiesResponse>(
      `https://www.wikidata.org/w/api.php?${params.toString()}`,
      'wikidata',
    );

    const labels = data.entities?.[entityId]?.labels ?? {};

    return labels[language]?.value ?? labels.en?.value ?? null;
  }
}

/** O título do artigo, tanto de `/wiki/Título` quanto de `?title=Título`. */
export function articleTitleOf(url: URL): string | null {
  const fromPath = url.pathname.match(/^\/wiki\/(.+)$/)?.[1];

  return fromPath || url.searchParams.get('title') || null;
}

/** Tira da URL o que veio depois de `?` — a API acrescenta rastreio à imagem. */
export function stripQuery(url: string | null): string | null {
  return url ? url.split('?')[0] : null;
}

function firstValue(
  claims: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>,
  property: string,
): unknown {
  return claims[property]?.[0]?.mainsnak?.datavalue?.value ?? null;
}

function timeOf(value: unknown): WikidataTime | null {
  if (!value || typeof value !== 'object' || !('time' in value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return typeof record.time === 'string' && typeof record.precision === 'number'
    ? {
        time: record.time,
        precision: record.precision,
        calendarmodel:
          typeof record.calendarmodel === 'string'
            ? record.calendarmodel
            : undefined,
      }
    : null;
}

function entityIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('id' in value)) {
    return null;
  }

  const id = (value as Record<string, unknown>).id;

  return typeof id === 'string' ? id : null;
}
