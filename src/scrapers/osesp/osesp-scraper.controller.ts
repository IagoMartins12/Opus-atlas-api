import { Controller, Get, UseGuards } from '@nestjs/common';
import { OsespScraperService } from './osesp-scraper.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ScraperResponse } from '../../common/interfaces/scraped-event.interface';

@Controller('scrapers/osesp')
@UseGuards(ApiKeyGuard)
export class OsespScraperController {
  constructor(private readonly osespScraperService: OsespScraperService) {}

  @Get('scrape')
  async scrape(): Promise<ScraperResponse> {
    return this.osespScraperService.scrapeAndCheckDuplicates();
  }

  @Get('status')
  getStatus() {
    return {
      scraper: 'OSESP',
      status: 'active',
      endpoint: '/api/scrapers/osesp/scrape',
    };
  }
}
