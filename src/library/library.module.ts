import { Module } from '@nestjs/common';
import { FavoritesModule } from './favorites/favorites.module';
import { LearningModule } from './learning/learning.module';
import { AnnotationsModule } from './annotations/annotations.module';
import { ContributionsModule } from './contributions/contributions.module';

@Module({
  imports: [
    FavoritesModule,
    LearningModule,
    AnnotationsModule,
    ContributionsModule,
  ],
})
export class LibraryModule {}
