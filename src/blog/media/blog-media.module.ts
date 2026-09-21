import { Module } from '@nestjs/common';
import { BlogMediaAdminController } from './blog-media-admin.controller';
import { BlogMediaController } from './blog-media.controller';
import { BlogMediaService } from './blog-media.service';

@Module({
  controllers: [BlogMediaController, BlogMediaAdminController],
  providers: [BlogMediaService],
  // A gravação de artigo usa `adoptDrafts`.
  exports: [BlogMediaService],
})
export class BlogMediaModule {}
