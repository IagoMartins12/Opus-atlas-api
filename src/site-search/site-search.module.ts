import { Module } from '@nestjs/common';
import { SearchModule as BlogSearchModule } from '../blog/search/search.module';
import { ComposersModule } from '../catalog/composers/composers.module';
import { WorksModule } from '../catalog/works/works.module';
import { SiteSearchController } from './site-search.controller';
import { SiteSearchService } from './site-search.service';

@Module({
  imports: [ComposersModule, WorksModule, BlogSearchModule],
  controllers: [SiteSearchController],
  providers: [SiteSearchService],
})
export class SiteSearchModule {}
