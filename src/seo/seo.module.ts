import { Module } from '@nestjs/common';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';

/** Dados para SEO que o front monta (Etapa 1.7): hoje, o sitemap. */
@Module({
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
