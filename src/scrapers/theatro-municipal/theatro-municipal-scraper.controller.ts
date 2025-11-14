import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { TheatroMunicipalScraperService } from './theatro-municipal-scraper.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ScraperResponse } from '../../common/interfaces/scraped-event.interface';

@Controller('scrapers/theatro-municipal')
@UseGuards(ApiKeyGuard)
export class TheatroMunicipalScraperController {
  constructor(
    private readonly theatroMunicipalScraperService: TheatroMunicipalScraperService,
  ) {}

  @Get('scrape')
  async scrape(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ScraperResponse> {
    // Opcional: permitir customizar datas via query params
    if (startDate) {
      this.theatroMunicipalScraperService['options'].startDate = new Date(
        startDate,
      );
    }
    if (endDate) {
      this.theatroMunicipalScraperService['options'].endDate = new Date(
        endDate,
      );
    }

    return this.theatroMunicipalScraperService.scrapeAndCheckDuplicates();
  }

  @Get('status')
  getStatus() {
    return {
      scraper: 'Theatro Municipal',
      status: 'active',
      endpoint: '/api/scrapers/theatro-municipal/scrape',
      optionalParams: {
        startDate: 'YYYY-MM-DD (opcional)',
        endDate: 'YYYY-MM-DD (opcional)',
      },
    };
  }
}
