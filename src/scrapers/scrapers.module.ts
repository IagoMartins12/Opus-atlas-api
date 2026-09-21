import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditorioIbirapueraScraperService } from './auditorio-ibirapuera/auditorio-ibirapuera-scraper.service';
import { CidadeDasArtesScraperService } from './cidade-das-artes/cidade-das-artes-scraper.service';
import { ComposerWorksService } from './imslp/composer-works.service';
import { ExternalPageFetcher } from './imslp/external-page.fetcher';
import { ImslpController } from './imslp/imslp.controller';
import { ImslpApiClient } from './imslp/imslp-api.client';
import { ImslpComposerScraper } from './imslp/imslp-composer.scraper';
import { ImslpImportService } from './imslp/imslp-import.service';
import { ImslpWorkScraper } from './imslp/imslp-work.scraper';
import { ImportService } from './import/import.service';
import { OsespScraperService } from './osesp/osesp-scraper.service';
import { SalaCeciliaMeirelesScraperService } from './sala-cecilia-meireles/sala-cecilia-meireles-scraper.service';
import { ScraperDispatchService } from './scraper-dispatch.service';
import { ScraperRegistry } from './scraper-registry';
import { ScraperRunService } from './scraper-run.service';
import { ScrapersController } from './scrapers.controller';
import { TeatroAmazonasScraperService } from './teatro-amazonas/teatro-amazonas-scraper.service';
import { TheatroDaPazScraperService } from './theatro-da-paz/theatro-da-paz-scraper.service';
import { TheatroMunicipalScraperService } from './theatro-municipal/theatro-municipal-scraper.service';
import { WikipediaComposerClient } from './wikipedia/wikipedia-composer.client';
import { WikipediaComposerScraper } from './wikipedia/wikipedia-composer.scraper';
import { WikipediaController } from './wikipedia/wikipedia.controller';

/**
 * Scraping da programação das casas de espetáculo.
 *
 * **O `ScraperJobsService` saiu.** Ele guardava o estado de cada rodada num
 * `Map` do processo, com um `setTimeout` que apagava o registro cinco minutos
 * depois — estado que não sobrevivia a reinício, não existia entre réplicas
 * (consultar o job numa instância diferente devolvia "não encontrado") e sumia
 * antes de a rodada terminar em qualquer casa maior. Quem guarda estado de job
 * agora é a fila, e quem o lê é `GET /admin/jobs/scraper/:jobId`.
 *
 * `ScraperRunService` é exportado porque o processor no `WorkerModule` o chama.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ScrapersController, ImslpController, WikipediaController],
  providers: [
    OsespScraperService,
    TheatroMunicipalScraperService,
    SalaCeciliaMeirelesScraperService,
    TeatroAmazonasScraperService,
    TheatroDaPazScraperService,
    AuditorioIbirapueraScraperService,
    CidadeDasArtesScraperService,
    ImportService,
    ScraperRegistry,
    ScraperRunService,
    ScraperDispatchService,
    ExternalPageFetcher,
    ImslpApiClient,
    ImslpComposerScraper,
    ImslpWorkScraper,
    ComposerWorksService,
    ImslpImportService,
    WikipediaComposerClient,
    WikipediaComposerScraper,
  ],
  // `ImportService` e `ScraperRegistry` saem para o calendário do blog, que
  // importa em lote os eventos escolhidos no painel.
  exports: [ScraperRunService, ImportService, ScraperRegistry],
})
export class ScrapersModule {}
