import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ComposerFavoriteListResponseDto,
  ComposerFavoriteStatusResponseDto,
  ToggleComposerFavoriteResponseDto,
} from './dto/composer-favorite.dto';
import { ToggleComposerFavoriteDto } from './dto/toggle-composer-favorite.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('library-favorites')
@ApiBearerAuth('access-token')
@ApiExtraModels(
  ComposerFavoriteListResponseDto,
  ComposerFavoriteStatusResponseDto,
)
@Controller('favorites/composers')
export class ComposerFavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista os compositores favoritos do usuário, ou verifica um específico',
    description:
      'Sem `composerId`: retorna a lista completa. Com `composerId`: retorna apenas se ' +
      'aquele compositor está favoritado.',
  })
  @ApiQuery({ name: 'composerId', required: false })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ComposerFavoriteListResponseDto) },
        { $ref: getSchemaPath(ComposerFavoriteStatusResponseDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async find(
    @CurrentUser() user: AccessTokenPayload,
    @Query('composerId') composerId?: string,
  ): Promise<
    ComposerFavoriteListResponseDto | ComposerFavoriteStatusResponseDto
  > {
    if (composerId) {
      return this.favoritesService.getComposerFavoriteStatus(
        user.sub,
        composerId,
      );
    }

    return this.favoritesService.listComposerFavorites(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Favorita ou desfavorita um compositor' })
  @ApiOkResponse({ type: ToggleComposerFavoriteResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async toggle(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ToggleComposerFavoriteDto,
  ): Promise<ToggleComposerFavoriteResponseDto> {
    return this.favoritesService.toggleComposerFavorite(user.sub, dto);
  }
}
