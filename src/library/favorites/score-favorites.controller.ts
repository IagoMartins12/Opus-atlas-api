import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ScoreSource } from '@prisma/client';
import { Public } from '../../common/decorators/api-key.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ScoreFavoriteActionResponseDto,
  ScoreFavoriteListResponseDto,
  ScoreFavoriteStatusResponseDto,
  WorkScoreStatItemDto,
  WorkScoreStatsResponseDto,
} from './dto/score-favorite.dto';
import { ToggleScoreFavoriteDto } from './dto/toggle-score-favorite.dto';
import { FavoritesService } from './favorites.service';

type ScoreFavoritesQueryType =
  | 'work-stats'
  | 'most-favorited'
  | 'check-favorite'
  | 'user-favorites';

@ApiTags('library-favorites')
@Controller('favorites/scores')
export class ScoreFavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({
    summary:
      'Favoritos de partitura do usuário, ou estatísticas públicas de uma obra',
    description:
      '`type=work-stats` e `type=most-favorited` são públicos (não exigem login) e retornam ' +
      'estatísticas agregadas de favoritos por partitura de uma obra. Os demais modos ' +
      '(`check-favorite`, `user-favorites`, padrão) exigem autenticação.',
  })
  @ApiQuery({ name: 'workId', required: false })
  @ApiQuery({ name: 'scoreId', required: false })
  @ApiQuery({ name: 'scoreSource', required: false, enum: ScoreSource })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['work-stats', 'most-favorited', 'check-favorite', 'user-favorites'],
  })
  @ApiOkResponse({ type: ScoreFavoriteListResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async find(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query('workId') workId?: string,
    @Query('scoreId') scoreId?: string,
    @Query('scoreSource') scoreSource: ScoreSource = ScoreSource.IMSLP,
    @Query('type') type: ScoreFavoritesQueryType = 'user-favorites',
  ): Promise<
    | ScoreFavoriteListResponseDto
    | ScoreFavoriteStatusResponseDto
    | WorkScoreStatsResponseDto
    | WorkScoreStatItemDto[]
  > {
    if (type === 'work-stats' || type === 'most-favorited') {
      if (!workId) {
        throw new BadRequestException('workId é obrigatório para estatísticas');
      }

      return type === 'work-stats'
        ? this.favoritesService.getWorkScoreStats(workId)
        : this.favoritesService.getMostFavoritedScore(workId);
    }

    if (!user) {
      throw new UnauthorizedException('Não autorizado');
    }

    if (type === 'check-favorite') {
      if (!workId || !scoreId) {
        throw new BadRequestException(
          'workId e scoreId são obrigatórios para check-favorite',
        );
      }

      return this.favoritesService.getScoreFavoriteStatus(
        user.sub,
        workId,
        scoreId,
        scoreSource,
      );
    }

    return this.favoritesService.listScoreFavorites(user.sub, workId);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Adiciona, atualiza ou remove uma partitura dos favoritos',
  })
  @ApiOkResponse({ type: ScoreFavoriteActionResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async toggle(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ToggleScoreFavoriteDto,
  ): Promise<ScoreFavoriteActionResponseDto> {
    return this.favoritesService.toggleScoreFavorite(user.sub, dto);
  }
}
