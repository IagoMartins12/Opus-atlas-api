import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { TagsAdminController } from './tags-admin.controller';
import { TagsAdminService } from './tags-admin.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  // `ArticlesModule` fornece a listagem que `GET /blog/tags/:slug/articles`
  // reaproveita.
  imports: [ArticlesModule],
  controllers: [TagsController, TagsAdminController],
  providers: [TagsService, TagsAdminService],
})
export class TagsModule {}
