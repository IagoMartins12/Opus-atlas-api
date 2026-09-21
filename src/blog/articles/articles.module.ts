import { Module } from '@nestjs/common';
import { BlogMediaModule } from '../media/blog-media.module';
import { ArticlesController } from './articles.controller';
import { ArticlesAdminController } from './articles-admin.controller';
import { ArticlesService } from './articles.service';
import { ArticlePublishingService } from './article-publishing.service';
import { ArticleWriterService } from './article-writer.service';

@Module({
  // `BlogMediaModule`: a gravação do artigo adota os arquivos de rascunho.
  imports: [BlogMediaModule],
  controllers: [ArticlesController, ArticlesAdminController],
  providers: [ArticlesService, ArticleWriterService, ArticlePublishingService],
  // `ArticlePublishingService` sai daqui para o worker: é ele que a varredura
  // de agendados chama.
  exports: [ArticlesService, ArticlePublishingService],
})
export class ArticlesModule {}
