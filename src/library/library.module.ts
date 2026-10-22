import { Module } from '@nestjs/common';
import { FavoritesModule } from './favorites/favorites.module';
import { LearningModule } from './learning/learning.module';
import { AnnotationsModule } from './annotations/annotations.module';
import { CollectionsModule } from './collections/collections.module';
import { ContributionsModule } from './contributions/contributions.module';
import { RetrospectiveModule } from './retrospective/retrospective.module';

@Module({
  imports: [
    FavoritesModule,
    LearningModule,
    RetrospectiveModule,
    AnnotationsModule,
    ContributionsModule,
    CollectionsModule,
  ],
})
export class LibraryModule {}
