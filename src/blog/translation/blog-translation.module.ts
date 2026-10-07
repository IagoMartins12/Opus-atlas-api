import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { BlogTranslationController } from './blog-translation.controller';
import { BlogTranslationService } from './blog-translation.service';

@Module({
  imports: [AiModule],
  controllers: [BlogTranslationController],
  providers: [BlogTranslationService],
})
export class BlogTranslationModule {}
