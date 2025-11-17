import { Module } from '@nestjs/common';
import { OsespScraperService } from './osesp/osesp-scraper.service';
import { TheatroMunicipalScraperService } from './theatro-municipal/theatro-municipal-scraper.service';
import { SalaCeciliaMeirelesScraperService } from './sala-cecilia-meireles/sala-cecilia-meireles-scraper.service'; // ✅ ADICIONAR
import { TeatroAmazonasScraperService } from './teatro-amazonas/teatro-amazonas-scraper.service'; // ✅ ADICIONAR
import { TheatroDaPazScraperService } from './theatro-da-paz/theatro-da-paz-scraper.service'; // ✅ ADICIONAR
import { AuditorioIbirapueraScraperService } from './auditorio-ibirapuera/auditorio-ibirapuera-scraper.service'; // ✅ ADICIONAR
import { CidadeDasArtesScraperService } from './cidade-das-artes/cidade-das-artes-scraper.service'; // ✅ ADICIONAR
import { ScraperJobsService } from './jobs/scraper-jobs.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ImportService } from './import/import.service';
import { ScrapersController } from './scrapers.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScrapersController],
  providers: [
    OsespScraperService,
    TheatroMunicipalScraperService,
    SalaCeciliaMeirelesScraperService, // ✅
    TeatroAmazonasScraperService, // ✅
    TheatroDaPazScraperService, // ✅
    AuditorioIbirapueraScraperService, // ✅
    CidadeDasArtesScraperService, // ✅
    ScraperJobsService,
    ImportService,
  ],
  exports: [ScraperJobsService],
})
export class ScrapersModule {}
