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
import { ToggleWorkFavoriteDto } from './dto/toggle-work-favorite.dto';
import {
  ToggleWorkFavoriteResponseDto,
  WorkFavoriteListResponseDto,
  WorkFavoriteStatusResponseDto,
} from './dto/work-favorite.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('library-favorites')
@ApiBearerAuth('access-token')
@ApiExtraModels(WorkFavoriteListResponseDto, WorkFavoriteStatusResponseDto)
@Controller('favorites/works')
export class WorkFavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista as obras favoritas do usuário, ou verifica uma específica',
    description:
      'Sem `workId`: retorna a lista completa. Com `workId`: retorna apenas se aquela ' +
      'obra está favoritada.',
  })
  @ApiQuery({ name: 'workId', required: false })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(WorkFavoriteListResponseDto) },
        { $ref: getSchemaPath(WorkFavoriteStatusResponseDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async find(
    @CurrentUser() user: AccessTokenPayload,
    @Query('workId') workId?: string,
  ): Promise<WorkFavoriteListResponseDto | WorkFavoriteStatusResponseDto> {
    if (workId) {
      return this.favoritesService.getWorkFavoriteStatus(user.sub, workId);
    }

    return this.favoritesService.listWorkFavorites(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Favorita ou desfavorita uma obra' })
  @ApiOkResponse({ type: ToggleWorkFavoriteResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async toggle(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ToggleWorkFavoriteDto,
  ): Promise<ToggleWorkFavoriteResponseDto> {
    return this.favoritesService.toggleWorkFavorite(user.sub, dto);
  }
}
