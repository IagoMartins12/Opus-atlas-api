import { Module } from '@nestjs/common';
import { OsespScraperController } from './osesp/osesp-scraper.controller';
import { OsespScraperService } from './osesp/osesp-scraper.service';
import { TheatroMunicipalScraperController } from './theatro-municipal/theatro-municipal-scraper.controller';
import { TheatroMunicipalScraperService } from './theatro-municipal/theatro-municipal-scraper.service';
import { ScraperJobsService } from './jobs/scraper-jobs.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ImportService } from './import/import.service';

@Module({
  imports: [PrismaModule],
  controllers: [OsespScraperController, TheatroMunicipalScraperController],
  providers: [
    OsespScraperService,
    TheatroMunicipalScraperService,
    ScraperJobsService, // ✅ Adicionar
    ImportService,
  ],
  exports: [ScraperJobsService],
})
export class ScrapersModule {}
