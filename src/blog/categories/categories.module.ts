import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { CategoriesAdminController } from './categories-admin.controller';
import { CategoriesAdminService } from './categories-admin.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  // `ArticlesModule` fornece a listagem que `GET /blog/categories/:slug/articles`
  // reaproveita.
  imports: [ArticlesModule],
  controllers: [CategoriesController, CategoriesAdminController],
  providers: [CategoriesService, CategoriesAdminService],
})
export class CategoriesModule {}
