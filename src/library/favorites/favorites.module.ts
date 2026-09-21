import { Module } from '@nestjs/common';
import { ComposerFavoritesController } from './composer-favorites.controller';
import { WorkFavoritesController } from './work-favorites.controller';
import { ScoreFavoritesController } from './score-favorites.controller';
import { FavoritesService } from './favorites.service';

@Module({
  controllers: [
    ComposerFavoritesController,
    WorkFavoritesController,
    ScoreFavoritesController,
  ],
  providers: [FavoritesService],
})
export class FavoritesModule {}
