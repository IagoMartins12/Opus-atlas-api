import { BadRequestException, Injectable } from '@nestjs/common';
import { BaseScraper } from './base/base-scraper';
import { AuditorioIbirapueraScraperService } from './auditorio-ibirapuera/auditorio-ibirapuera-scraper.service';
import { CidadeDasArtesScraperService } from './cidade-das-artes/cidade-das-artes-scraper.service';
import { OsespScraperService } from './osesp/osesp-scraper.service';
import { SalaCeciliaMeirelesScraperService } from './sala-cecilia-meireles/sala-cecilia-meireles-scraper.service';
import { TeatroAmazonasScraperService } from './teatro-amazonas/teatro-amazonas-scraper.service';
import { TheatroDaPazScraperService } from './theatro-da-paz/theatro-da-paz-scraper.service';
import { TheatroMunicipalScraperService } from './theatro-municipal/theatro-municipal-scraper.service';

export const SCRAPER_IDS = [
  'osesp',
  'theatro-municipal',
  'sala-cecilia-meireles',
  'teatro-amazonas',
  'theatro-da-paz',
  'auditorio-ibirapuera',
  'cidade-das-artes',
] as const;

export type ScraperId = (typeof SCRAPER_IDS)[number];

export function isScraperId(value: string): value is ScraperId {
  return (SCRAPER_IDS as readonly string[]).includes(value);
}

/**
 * Os scrapers disponíveis, por identificador.
 *
 * O mapa vivia montado no construtor do controller, o que atrelava a lista de
 * scrapers à camada HTTP — e agora quem precisa dela é o worker, que não tem
 * controller nenhum. Aqui a lista é um provider, com o id tipado como união em
 * vez de `string` solta.
 */
@Injectable()
export class ScraperRegistry {
  private readonly scrapers: Map<ScraperId, BaseScraper>;

  constructor(
    osesp: OsespScraperService,
    theatroMunicipal: TheatroMunicipalScraperService,
    salaCecilia: SalaCeciliaMeirelesScraperService,
    teatroAmazonas: TeatroAmazonasScraperService,
    theatroDaPaz: TheatroDaPazScraperService,
    auditorioIbirapuera: AuditorioIbirapueraScraperService,
    cidadeDasArtes: CidadeDasArtesScraperService,
  ) {
    this.scrapers = new Map<ScraperId, BaseScraper>([
      ['osesp', osesp],
      ['theatro-municipal', theatroMunicipal],
      ['sala-cecilia-meireles', salaCecilia],
      ['teatro-amazonas', teatroAmazonas],
      ['theatro-da-paz', theatroDaPaz],
      ['auditorio-ibirapuera', auditorioIbirapuera],
      ['cidade-das-artes', cidadeDasArtes],
    ]);
  }

  list() {
    return [...this.scrapers.entries()].map(([id, scraper]) => {
      const config = scraper.getConfig();

      return {
        id,
        venueName: config.venueName,
        venueSlug: config.venueSlug,
        baseUrl: config.baseUrl,
      };
    });
  }

  /** Valida o identificador e o estreita para a união. */
  requireId(id: string): ScraperId {
    if (!isScraperId(id)) {
      throw new BadRequestException(
        `Scraper desconhecido: "${id}". Existem: ${SCRAPER_IDS.join(', ')}.`,
      );
    }

    return id;
  }

  /** O identificador é de um scraper registrado? */
  isRegistered(id: string): boolean {
    return isScraperId(id);
  }

  require(id: string): BaseScraper {
    // A união garante que o mapa tem a chave; o `!` é a consequência de o
    // `Map` não estreitar pelo tipo da chave.
    return this.scrapers.get(this.requireId(id))!;
  }
}
