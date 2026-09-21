import { Injectable, Logger } from '@nestjs/common';
import { ExternalPageFetcher } from './external-page.fetcher';

/** Uma página de categoria, já resolvida. */
export interface CategoryMember {
  /** Id numérico da página — o mesmo que o catálogo guarda em `Work.imslpId`. */
  pageid: number;
  /** Título da página, com o compositor entre parênteses no fim. */
  title: string;
}

/** Quantos membros por chamada. 500 é o teto para cliente anônimo. */
const PAGE_SIZE = 500;

/** Teto de chamadas encadeadas, para uma categoria não virar uma sessão inteira. */
const MAX_REQUESTS = 20;

interface CategoryMembersResponse {
  query?: {
    /** Mapa de id numérico para página. */
    pages?: Record<string, { pageid?: number; title?: string }>;
    /** De onde para onde o MediaWiki redirecionou, quando redirecionou. */
    redirects?: { from: string; to: string }[];
  };
  /** MediaWiki moderno. */
  continue?: { gcmcontinue?: string };
  /** MediaWiki anterior à 1.26 — é o que o IMSLP roda. */
  'query-continue'?: { categorymembers?: { gcmcontinue?: string } };
}

/**
 * Fala com a API do MediaWiki do IMSLP.
 *
 * **A descoberta lia a listagem HTML da categoria, e a listagem é paginada.**
 * O MediaWiki mostra 200 páginas por vez com um link "next 200"; o parser não
 * o seguia. Medido contra o IMSLP real: a categoria do Beethoven anuncia
 * "The following 200 pages are in this category, **out of 361 total**", e a
 * descoberta devolvia as 200 primeiras dizendo `truncated: false`. Bach é
 * pior: **1.431 obras em 3 chamadas**, das quais se via a primeira.
 *
 * Pior que o número era o identificador. A listagem HTML dá o **nome da
 * página**, e o catálogo guarda o **id numérico** — 205.985 das 207.880 obras
 * têm `imslpId` numérico, porque a carga inicial veio da API oficial de
 * worklist, que devolve `pageid`. Os dois nunca se cruzavam: a descoberta do
 * Beethoven relatava `0 já no catálogo` quando **357 das 361 já estavam lá**.
 *
 * **`redirects=1` é o terceiro motivo, e o mais silencioso.** A categoria de um
 * compositor lista páginas de redirecionamento junto com as obras, e o
 * redirecionamento do MediaWiki é interno: a URL responde 200 com o conteúdo
 * de outra página, de outro id — às vezes **de outro compositor**. Sem
 * resolver, a descoberta oferece o redirecionamento como obra nova para
 * sempre, porque o id que ela mostra nunca é o id que a importação grava.
 * Medido no Beethoven: 2 dos 361 membros são redirecionamento, e um deles
 * aponta para `Funeral March No.1 (Walch, Johann Heinrich)`.
 */
@Injectable()
export class ImslpApiClient {
  private readonly logger = new Logger(ImslpApiClient.name);

  constructor(private readonly fetcher: ExternalPageFetcher) {}

  /**
   * Lista as páginas de uma categoria, seguindo a paginação até o fim.
   *
   * `truncated` diz se o teto de chamadas foi atingido antes de a categoria
   * acabar — a resposta precisa distinguir "isto é tudo" de "isto é o que
   * coube", porque quem lê decide importar com base nela.
   */
  async listCategoryMembers(
    categoryTitle: string,
  ): Promise<{ members: CategoryMember[]; truncated: boolean }> {
    const members = new Map<number, CategoryMember>();
    let cursor: string | null = null;
    let requests = 0;
    let redirects = 0;

    do {
      const { data } = await this.fetcher.loadJson<CategoryMembersResponse>(
        this.categoryMembersUrl(categoryTitle, cursor),
        'imslp',
      );

      for (const member of pagesOf(data)) {
        // O mapa por id resolve dois membros que redirecionam para a mesma
        // página — que é o que o `generator` devolve quando isso acontece.
        members.set(member.pageid, member);
      }

      redirects += data.query?.redirects?.length ?? 0;
      requests += 1;

      cursor = nextCursor(data);
    } while (cursor && requests < MAX_REQUESTS);

    this.logger.log(
      `API do IMSLP: ${members.size} páginas em "${categoryTitle}" ` +
        `(${requests} chamada${requests === 1 ? '' : 's'}, ` +
        `${redirects} redirecionamento${redirects === 1 ? '' : 's'} resolvido${redirects === 1 ? '' : 's'})`,
    );

    return { members: [...members.values()], truncated: cursor !== null };
  }

  private categoryMembersUrl(
    categoryTitle: string,
    cursor: string | null,
  ): string {
    const params = new URLSearchParams({
      action: 'query',
      // `generator` em vez de `list`: só ele aceita `redirects=1`, que faz o
      // MediaWiki devolver a página de destino no lugar do redirecionamento.
      generator: 'categorymembers',
      gcmtitle: categoryTitle,
      gcmlimit: String(PAGE_SIZE),
      // Só páginas: subcategoria de compositor é agrupamento do IMSLP, não
      // obra. Medido na categoria do Beethoven: zero subcategorias.
      gcmtype: 'page',
      redirects: '1',
      format: 'json',
    });

    if (cursor) {
      params.set('gcmcontinue', cursor);
    }

    return `https://imslp.org/api.php?${params.toString()}`;
  }
}

/**
 * As páginas da resposta, descartando o que não tem id.
 *
 * O `generator` devolve `query.pages` como um **mapa**, e uma página que o
 * MediaWiki não conhece entra nele com chave negativa e sem `pageid`.
 */
export function pagesOf(data: CategoryMembersResponse): CategoryMember[] {
  return Object.values(data.query?.pages ?? {}).flatMap((page) =>
    typeof page.pageid === 'number' && typeof page.title === 'string'
      ? [{ pageid: page.pageid, title: page.title }]
      : [],
  );
}

/**
 * O cursor da próxima página, nas duas formas em que o MediaWiki o publica.
 *
 * A partir da 1.26 ele vem em `continue`; antes disso, em `query-continue`.
 * **O IMSLP responde na forma antiga** — conferido contra o servidor real, que
 * devolveu `query-continue.categorymembers.gcmcontinue` e nenhum `continue`.
 * Ler só a forma moderna faria a paginação parar em silêncio na primeira
 * página, que é exatamente um dos defeitos que este cliente veio corrigir.
 */
export function nextCursor(data: CategoryMembersResponse): string | null {
  return (
    data.continue?.gcmcontinue ??
    data['query-continue']?.categorymembers?.gcmcontinue ??
    null
  );
}
