import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { isAdmin } from '../../common/auth/roles';
import { Public } from '../../common/decorators/api-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CollectionsService } from './collections.service';
import {
  CandidatesQueryDto,
  CreateCollectionDto,
  FeatureCollectionDto,
  ListCollectionsQueryDto,
  UpdateCollectionDto,
} from './dto/collection-input.dto';
import {
  CollectionDetailDto,
  CollectionEntryDto,
  CollectionListDto,
  MyCollectionsDto,
} from './dto/collection.dto';

@ApiTags('library-collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({
    summary:
      'Coleções públicas (as da equipe primeiro, depois as mais favoritadas)',
  })
  @ApiOkResponse({ type: CollectionListDto })
  list(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query() query: ListCollectionsQueryDto,
  ): Promise<CollectionListDto> {
    return this.collections.list(query, user?.sub);
  }

  @Get('mine')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'As suas coleções e as que você favoritou' })
  @ApiOkResponse({ type: MyCollectionsDto })
  mine(@CurrentUser() user: AccessTokenPayload): Promise<MyCollectionsDto> {
    return this.collections.mine(user.sub);
  }

  @Get('candidates')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'O que o editor oferece enquanto a pessoa digita' })
  @ApiOkResponse({ type: [CollectionEntryDto] })
  candidates(
    @Query() query: CandidatesQueryDto,
  ): Promise<CollectionEntryDto[]> {
    return this.collections.candidates(query);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Uma coleção, com os itens (pública ou sua)' })
  @ApiOkResponse({ type: CollectionDetailDto })
  get(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('id') id: string,
  ): Promise<CollectionDetailDto> {
    return this.collections.get(id, user?.sub);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cria uma coleção (e-mail confirmado)' })
  @ApiOkResponse({ type: CollectionDetailDto })
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionDetailDto> {
    return this.collections.create(user.sub, dto);
  }

  @Put(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza a sua coleção (o tipo não muda)' })
  @ApiOkResponse({ type: CollectionDetailDto })
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionDetailDto> {
    return this.collections.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Apaga uma coleção (dono ou admin)' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.collections.remove(user.sub, isAdmin(user.role), id);
  }

  @Post(':id/favorite')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Favorita uma coleção pública' })
  favorite(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.collections.favorite(user.sub, id, true);
  }

  @Delete(':id/favorite')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tira a coleção dos favoritos' })
  unfavorite(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.collections.favorite(user.sub, id, false);
  }

  @Patch(':id/featured')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Põe ou tira a coleção da home (equipe)' })
  feature(@Param('id') id: string, @Body() dto: FeatureCollectionDto) {
    return this.collections.setFeatured(id, dto.featuredOnHome);
  }
}
