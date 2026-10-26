import { Module } from '@nestjs/common';
import { SeoController } from './seo.controller';
import { IndexNowService } from './indexnow.service';
import { SeoService } from './seo.service';

/**
 * Dados para SEO que o front monta (Etapa 1.7): o sitemap; e o aviso aos
 * buscadores do que mudou (IndexNow), que o worker roda.
 */
@Module({
  controllers: [SeoController],
  providers: [SeoService, IndexNowService],
  exports: [IndexNowService],
})
export class SeoModule {}
