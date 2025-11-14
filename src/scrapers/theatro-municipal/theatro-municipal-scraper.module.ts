import { Module } from '@nestjs/common';
import { TheatroMunicipalScraperController } from './theatro-municipal-scraper.controller';
import { TheatroMunicipalScraperService } from './theatro-municipal-scraper.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [TheatroMunicipalScraperController],
  providers: [TheatroMunicipalScraperService, PrismaService],
  exports: [TheatroMunicipalScraperService],
})
export class TheatroMunicipalScraperModule {}
