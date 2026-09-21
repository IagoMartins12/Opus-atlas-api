import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { GetWorksCatalogQueryDto } from './dto/get-works-catalog-query.dto';
import { GetWorkScoresQueryDto } from './dto/get-work-scores-query.dto';
import { SearchWorksQueryDto } from './dto/search-works-query.dto';
import { SearchWorkGenresQueryDto } from './dto/search-work-genres-query.dto';
import { WorkFilterOptionsResponseDto } from './dto/work-filter-options-response.dto';
import { WorkDetailDto } from './dto/work-detail.dto';
import { WorkGenreItemDto } from './dto/work-genre-item.dto';
import { RelatedWorkItemDto } from './dto/related-work-item.dto';
import { UpdateWorkMediaDto } from './dto/update-work-media.dto';
import { WorkMediaResponseDto } from './dto/work-media-response.dto';
import {
  ClearWorkMediaResponseDto,
  RefreshWorkScoresResponseDto,
} from './dto/work-media-clear-response.dto';
import { WorkScoresResponseDto } from './dto/work-score-item.dto';
import { WorksCatalogResponseDto } from './dto/works-catalog-response.dto';
import { WorkSummaryDto } from './dto/work-summary.dto';
import { ImslpScoresService } from './imslp-scores.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorksService } from './works.service';

const MEDIA_TYPES = [
  'spotify',
  'youtube',
  'custom-audio',
  'video-aula',
] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

@ApiTags('catalog-works')
@Controller('works')
export class WorksController {
  constructor(
    private readonly worksService: WorksService,
    private readonly imslpScores: ImslpScoresService,
  ) {}

  @Public()
  @PublicCache({ maxAgeSeconds: 600, staleWhileRevalidateSeconds: 1800 })
  @Get()
  @ApiOperation({
    summary: 'Busca obras musicais por título, compositor ou catálogo',
    description:
      'Retorna uma lista de obras. Suporta busca textual via `q` (mínimo 2 caracteres), ' +
      'busca direta por `id`, e retorna as obras mais populares (por número de anotações) ' +
      'quando nenhum filtro é informado. Endpoint público, sem necessidade de autenticação. ' +
      'Resultado cacheado em Redis por 5 minutos (ver seção 3.7 do SPEC.md), invalidado por ' +
      'evento sempre que uma obra é criada, atualizada ou verificada.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Termo de busca (mín. 2 caracteres)',
    example: 'Sonata',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Máximo de resultados (1-50)',
    example: 10,
  })
  @ApiQuery({
    name: 'id',
    required: false,
    description: 'Busca direta por ID da obra',
  })
  @ApiOkResponse({
    description: 'Lista de obras encontradas (pode ser vazia)',
    type: [WorkSummaryDto],
  })
  @ApiBadRequestResponse({
    description: 'Parâmetros de busca inválidos',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findAll(
    @Query() query: SearchWorksQueryDto,
  ): Promise<WorkSummaryDto[]> {
    return this.worksService.search(query);
  }

  @Public()
  @PublicCache({ maxAgeSeconds: 300, staleWhileRevalidateSeconds: 1800 })
  @Get('catalog')
  @ApiOperation({
    summary: 'Lista paginada de obras com filtros avançados e cache agressivo',
    description:
      'Endpoint que substitui a request pesada `getWorks` do front. Suporta paginação, filtros por compositor, instrumento, época, gênero, ' +
      'dificuldade e busca textual. A resposta é cacheada por assinatura de filtros (TTL variável conforme o tipo da consulta) para reduzir carga no MongoDB.',
  })
  @ApiOkResponse({
    description: 'Página de obras retornada com sucesso',
    type: WorksCatalogResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parâmetros inválidos na paginação ou filtros',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findCatalog(
    @Query() query: GetWorksCatalogQueryDto,
  ): Promise<WorksCatalogResponseDto> {
    return this.worksService.getCatalog(query);
  }

  @Public()
  @PublicCache({ maxAgeSeconds: 1800, staleWhileRevalidateSeconds: 3600 })
  @Get('filter-options')
  @ApiOperation({
    summary: 'Carrega os filtros usados na listagem de obras',
    description:
      'Retorna instrumentos, épocas, gêneros, compositores populares e níveis de dificuldade usados no catálogo de obras. ' +
      'Resposta altamente cacheável e compartilhada entre visitantes.',
  })
  @ApiOkResponse({
    description: 'Filtros do catálogo retornados com sucesso',
    type: WorkFilterOptionsResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findFilterOptions(): Promise<WorkFilterOptionsResponseDto> {
    return this.worksService.getFilterOptions();
  }

  @Public()
  @PublicCache({ maxAgeSeconds: 1800, staleWhileRevalidateSeconds: 3600 })
  @Get('genres')
  @ApiOperation({
    summary: 'Lista todos os gêneros de obra cadastrados',
    description:
      'Lista completa (sem limite de 30 como em `filter-options`). Substitui a rota legada `getAllWorkGenres`.',
  })
  @ApiOkResponse({ type: [WorkGenreItemDto] })
  async findAllGenres(): Promise<WorkGenreItemDto[]> {
    return this.worksService.getAllGenres();
  }

  @Public()
  @Get('genres/search')
  @ApiOperation({
    summary: 'Autocomplete de gêneros de obra',
    description:
      'Usado no formulário de envio de obra da comunidade. Substitui a Server Action `searchGenresAction`.',
  })
  @ApiOkResponse({ type: [WorkGenreItemDto] })
  async searchGenres(
    @Query() query: SearchWorkGenresQueryDto,
  ): Promise<WorkGenreItemDto[]> {
    return this.worksService.searchGenres(query);
  }

  @Public()
  @PublicCache({ maxAgeSeconds: 900, staleWhileRevalidateSeconds: 1800 })
  @Get(':id/related')
  @ApiOperation({
    summary: 'Lista obras relacionadas (mesmo compositor e/ou instrumento)',
    description: 'Seção "obras relacionadas" da página de detalhe da obra.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 6 })
  @ApiOkResponse({ type: [RelatedWorkItemDto] })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  async findRelated(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<RelatedWorkItemDto[]> {
    return this.worksService.findRelated(
      id,
      limit ? Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20) : 6,
    );
  }

  @Public()
  @Get(':id/scores')
  @ApiOperation({
    summary: 'Lista as partituras (`WorkScore`) de uma obra',
    description:
      'Suporta busca geral paginada, paginação independente por categoria (`limitPerType`) ' +
      'e busca direta por `sourceId`+`source`. Substitui a rota legada `work-scores`.',
  })
  @ApiOkResponse({ type: WorkScoresResponseDto })
  async getScores(
    @Param('id') id: string,
    @Query() query: GetWorkScoresQueryDto,
  ): Promise<WorkScoresResponseDto> {
    return this.worksService.getScores(id, query);
  }

  @ApiBearerAuth('access-token')
  @Roles('ADMIN')
  @Post(':id/scores/refresh')
  @ApiOperation({
    summary: 'Relê as partituras da obra no IMSLP',
    description:
      'Grava os arquivos novos e atualiza os que já existem. A listagem pública ' +
      'já busca sozinha, uma vez, as obras sem nenhuma partitura; esta rota é ' +
      'para quando o IMSLP ganha arquivo novo numa obra que já tinha.',
  })
  @ApiOkResponse({ type: RefreshWorkScoresResponseDto })
  refreshScores(@Param('id') id: string) {
    return this.imslpScores.refresh(id);
  }

  @ApiBearerAuth('access-token')
  @Patch(':id/media')
  @ApiOperation({
    summary: 'Atualiza os campos de mídia de uma obra',
    description:
      'Spotify, YouTube, áudio customizado e vídeo aula. Só o autor da obra (`createdBy`) ' +
      'ou um admin pode editar.',
  })
  @ApiOkResponse({ type: WorkMediaResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'Usuário não é o autor da obra nem admin',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  async updateMedia(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateWorkMediaDto,
  ): Promise<WorkMediaResponseDto> {
    return this.worksService.updateMedia(id, user.sub, user.role >= 1, dto);
  }

  @ApiBearerAuth('access-token')
  @Delete(':id/media')
  @ApiOperation({
    summary: 'Remove um tipo específico de mídia de uma obra',
  })
  @ApiQuery({ name: 'type', enum: MEDIA_TYPES, required: true })
  @ApiOkResponse({ type: ClearWorkMediaResponseDto })
  @ApiBadRequestResponse({
    description: 'Tipo de mídia inválido',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'Usuário não é o autor da obra nem admin',
    type: ErrorResponseDto,
  })
  async clearMedia(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('type') type: string,
  ): Promise<{ success: true; clearedFields: string[] }> {
    if (!MEDIA_TYPES.includes(type as MediaType)) {
      throw new BadRequestException('Tipo de mídia inválido');
    }

    return this.worksService.clearMedia(
      id,
      user.sub,
      user.role >= 1,
      type as MediaType,
    );
  }

  @Public()
  @PublicCache({ maxAgeSeconds: 300, staleWhileRevalidateSeconds: 1800 })
  @Get(':id')
  @ApiOperation({
    summary: 'Retorna o detalhe completo de uma obra',
    description:
      'Expõe o payload completo da página de detalhe da obra, incluindo relações, mídias e hierarquia pai/filhas.',
  })
  @ApiOkResponse({
    description: 'Detalhe da obra retornado com sucesso',
    type: WorkDetailDto,
  })
  @ApiBadRequestResponse({
    description: 'ID da obra inválido',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  async findOne(@Param('id') id: string): Promise<WorkDetailDto> {
    return this.worksService.findOne(id);
  }
}
