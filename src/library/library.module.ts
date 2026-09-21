import { Module } from '@nestjs/common';
import { FavoritesModule } from './favorites/favorites.module';
import { LearningModule } from './learning/learning.module';
import { AnnotationsModule } from './annotations/annotations.module';

@Module({
  imports: [FavoritesModule, LearningModule, AnnotationsModule],
})
export class LibraryModule {}
