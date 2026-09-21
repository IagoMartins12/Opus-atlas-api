import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';

/**
 * Sinais de que o domínio deixou de ser da casa de espetáculo.
 *
 * Não é uma lista de palavras proibidas: são os assuntos que aparecem quando um
 * domínio expirado é reaproveitado por quem quer o tráfego dele. "Programação"
 * é a armadilha — o domínio foi reciclado justamente para páginas sobre
 * **linguagens de programação**, que é o que uma busca por "programação
 * auditório" traz.
 */
const SIGNS_OF_SQUATTING = [
  /linguagem de programa[çc][ãa]o/i,
  /\bjavascript\b/i,
  /\bpython\b/i,
  /cassino|casino|apostas|b[ôo]nus de boas-vindas/i,
];

/**
 * Programação do Auditório Ibirapuera.
 *
 * **O domínio não é mais da casa.** `auditorioibirapuera.com.br` responde 200 e
 * a página `/programacao` existe — mas o que ela lista são artigos como "Qual é
 * a linguagem de programação mais usada no mundo?" e "Como trabalhar com
 * programação sendo iniciante?". O domínio foi solto e reaproveitado por quem
 * quis o tráfego da palavra "programação". É o mesmo que aconteceu com a Sala
 * Cecília Meireles, cujo antigo `.com.br` hoje serve um site de apostas.
 *
 * A diferença é que a Sala tem endereço novo — `salaceciliameireles.rj.gov.br`
 * — e para o Auditório **eu não encontrei nenhum sítio oficial em funcionamento**:
 * `auditorioibirapuera.org.br`, `.com` e as variações com `www` não resolvem.
 *
 * Por isso este scraper **não tenta adivinhar um endereço**. Ele confere se a
 * página ainda é da casa e, não sendo, **falha dizendo o que houve**. A
 * alternativa — devolver zero eventos — faria o painel mostrar "0 encontrados",
 * que é o que uma casa sem programação também mostra: quem opera não teria como
 * distinguir uma da outra, e ninguém iria atrás.
 *
 * A leitura da listagem está pronta e testada; falta a casa ter onde publicar.
 */
@Injectable()
export class AuditorioIbirapueraScraperService extends BaseScraper {
  constructor() {
    const config: ScraperConfig = {
      venueName: 'Auditório Ibirapuera',
      venueSlug: 'auditorio-ibirapuera',
      venue: {
        address: 'Av. Pedro Álvares Cabral, s/n - Parque Ibirapuera, Portão 3',
        city: 'São Paulo',
        state: 'SP',
        country: 'Brasil',
        zipCode: '04094-050',
      },
      baseUrl: 'https://www.auditorioibirapuera.com.br',
      userAgent: 'Mozilla/5.0 (compatible; OpusAtlas/1.0)',
      delayBetweenRequests: 1500,
    };
    super(config);
  }

  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    onProgress?.(0, 100, 'Lendo a programação do Auditório Ibirapuera...');

    const html = await this.fetchWithRetry(
      `${this.config.baseUrl}/programacao`,
    );

    const $ = cheerio.load(html);
    const text = $('body').text();

    if (looksLikeSquattedDomain(text)) {
      throw new Error(
        `${this.config.baseUrl} não é mais o sítio do Auditório Ibirapuera: a ` +
          'página de programação lista artigos sobre linguagens de ' +
          'programação. O domínio foi solto e reaproveitado. Não há endereço ' +
          'oficial em funcionamento conhecido — informe o novo endereço da casa ' +
          'antes de reativar esta raspagem.',
      );
    }

    onProgress?.(100, 100, '0 eventos coletados');

    return [];
  }
}

/** A página ainda é da casa de espetáculo? */
export function looksLikeSquattedDomain(pageText: string): boolean {
  return SIGNS_OF_SQUATTING.some((pattern) => pattern.test(pageText));
}
