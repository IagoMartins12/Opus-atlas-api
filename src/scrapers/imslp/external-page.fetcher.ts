import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { errorMessage } from '../../common/utils/error.util';
import { CheerioDocument } from './imslp-work.parser';
import { ExternalSource, requireSourceUrl } from './source-url';

/** Quinze segundos, como no legado. Página de catálogo não demora mais que isso. */
const TIMEOUT_MS = 15_000;

/**
 * Teto do corpo da resposta.
 *
 * Sem ele, uma URL que devolve um fluxo infinito derruba o processo por
 * memória — e o endereço é escolhido por quem chama.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Busca uma página de fonte externa e devolve o documento carregado.
 *
 * **A validação da URL acontece aqui, e não em quem chama.** É a diferença
 * entre uma regra que se aplica e uma que depende de alguém lembrar: qualquer
 * caminho que chegue a uma requisição externa passa por `requireSourceUrl`,
 * que confere o **host** contra a lista fechada. No legado a checagem era
 * `url.includes('imslp.org')` dentro do handler, e a rota que a fazia não
 * exigia sequer login.
 */
@Injectable()
export class ExternalPageFetcher {
  private readonly logger = new Logger(ExternalPageFetcher.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      // Sem seguir redirecionamento: um redirecionamento leva a um host que
      // não passou pela lista — é o caminho clássico de contornar a validação
      // de URL depois de ela ter sido feita.
      maxRedirects: 0,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; OpusAtlas/1.0; +https://opusatlas.com)',
      },
      responseType: 'text',
    });
  }

  async load(
    rawUrl: string,
    expected?: ExternalSource,
  ): Promise<{ $: CheerioDocument; url: string; source: ExternalSource }> {
    const { url, source } = requireSourceUrl(rawUrl, expected);

    try {
      const response = await this.http.get<string>(url, {
        // Só HTML interessa aqui; o resto é recusado antes de virar documento.
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });

      const contentType = String(response.headers['content-type'] ?? '');

      if (!contentType.includes('html')) {
        throw new BadGatewayException(
          `A página respondeu "${contentType || 'sem tipo'}"; era esperado HTML.`,
        );
      }

      return { $: cheerio.load(response.data), url, source };
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.warn(`Falha ao buscar ${url}: ${errorMessage(error)}`);

      // O erro do provedor externo não é repassado ao cliente: ele carrega
      // endereço interno, cabeçalho e às vezes corpo da resposta.
      throw new BadGatewayException(
        `Não foi possível ler a página em ${source}. Tente novamente mais tarde.`,
      );
    }
  }

  /**
   * Busca JSON de fonte externa.
   *
   * Mesma instância de cliente HTTP, mesma validação de host, mesmos tetos de
   * tempo e de tamanho que a busca de HTML. **É esse compartilhamento que faz
   * a regra valer**: um segundo cliente HTTP, criado em outro lugar para falar
   * com a API, seria um segundo caminho para o servidor buscar um endereço
   * escolhido por quem chama — e sem passar por `requireSourceUrl`.
   */
  async loadJson<T>(
    rawUrl: string,
    expected?: ExternalSource,
  ): Promise<{ data: T; url: string; source: ExternalSource }> {
    const { url, source } = requireSourceUrl(rawUrl, expected);

    try {
      const response = await this.http.get<string>(url, {
        headers: { Accept: 'application/json' },
      });

      // `responseType: 'text'` vale para os dois casos: o corpo é lido como
      // texto e só então convertido, o que mantém o teto de bytes valendo.
      const data =
        typeof response.data === 'string'
          ? (JSON.parse(response.data) as T)
          : (response.data as T);

      return { data, url, source };
    } catch (error: unknown) {
      this.logger.warn(`Falha ao buscar ${url}: ${errorMessage(error)}`);

      throw new BadGatewayException(
        `Não foi possível ler os dados em ${source}. Tente novamente mais tarde.`,
      );
    }
  }
}
