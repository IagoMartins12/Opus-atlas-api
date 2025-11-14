import { Module } from '@nestjs/common';
import { OsespScraperModule } from './osesp/osesp-scraper.module';
import { TheatroMunicipalScraperModule } from './theatro-municipal/theatro-municipal-scraper.module'; // ✅ NOVO
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Module({
  imports: [
    OsespScraperModule,
    TheatroMunicipalScraperModule, // ✅ ADICIONAR AQUI
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class ScrapersModule {}
