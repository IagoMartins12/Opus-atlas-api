import { Module } from '@nestjs/common';
import { MediaSearchController } from './media-search.controller';
import { MediaSearchService } from './media-search.service';

@Module({
  controllers: [MediaSearchController],
  providers: [MediaSearchService],
  exports: [MediaSearchService],
})
export class MediaSearchModule {}
