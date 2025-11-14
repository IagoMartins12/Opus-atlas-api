import { Module } from '@nestjs/common';
import { OsespScraperService } from './osesp-scraper.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OsespScraperController } from './osesp-scraper.controller';

@Module({
  controllers: [OsespScraperController],
  providers: [OsespScraperService, PrismaService],
  exports: [OsespScraperService],
})
export class OsespScraperModule {}
