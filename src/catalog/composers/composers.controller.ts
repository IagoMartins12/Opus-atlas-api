import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ComposerCountQueryDto } from './dto/composer-count-query.dto';
import { ComposerDetailDto } from './dto/composer-detail.dto';
import { ComposerFilterOptionsResponseDto } from './dto/composer-filter-options-response.dto';
import { ComposerListItemDto } from './dto/composer-list-item.dto';
import { ComposerListQueryDto } from './dto/composer-list-query.dto';
import { ComposerWorksQueryDto } from './dto/composer-works-query.dto';
import { ComposerWorksResponseDto } from './dto/composer-works-response.dto';
import { ComposerWorkTypeCountsResponseDto } from './dto/composer-work-type-counts-response.dto';
import { FeaturedComposerResponseDto } from './dto/featured-composer-response.dto';
import { ComposersService } from './composers.service';
import { BiographyResult, ComposerBioService } from './composer-bio.service';
import { BiographyRequestDto } from './dto/biography-request.dto';
import {
  BiographyDraftDto,
  BiographyResponseDto,
  TranslateBiographyDto,
  TranslatedBiographyDto,
} from './dto/biography-draft.dto';

@ApiTags('catalog-composers')
@Controller('composers')
export class ComposersController {
  constructor(
    private readonly composersService: ComposersService,
    private readonly bioService: ComposerBioService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lista compositores com paginação e filtros básicos',
    description:
      'Substitui a request server-side de compositores do frontend com paginação, busca textual e filtro por época, mantendo o mesmo shape de resposta usado hoje no Next.',
  })
  @ApiOkResponse({
    description: 'Lista de compositores retornada com sucesso',
    type: [ComposerListItemDto],
  })
  @ApiBadRequestResponse({
    description: 'Parâmetros inválidos na paginação ou filtros',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findAll(
    @Query() query: ComposerListQueryDto,
  ): Promise<ComposerListItemDto[]> {
    return this.composersService.findAll(query);
  }

  @Public()
  @Get('count')
  @ApiOperation({
    summary: 'Retorna a contagem de compositores para os filtros informados',
    description:
      'Usado para paginação do catálogo de compositores. Reaplica exatamente as mesmas regras de busca e filtro por época do endpoint principal.',
  })
  @ApiOkResponse({
    description: 'Contagem total retornada com sucesso',
    schema: { type: 'number', example: 248 },
  })
  @ApiBadRequestResponse({
    description: 'Parâmetros inválidos no filtro',
    type: ErrorResponseDto,
  })
  async count(@Query() query: ComposerCountQueryDto): Promise<number> {
    return this.composersService.count(query);
  }

  @Public()
  @Get('famous')
  @ApiOperation({
    summary: 'Lista a curadoria de compositores famosos da home',
    description:
      'Retorna a seleção estática de compositores famosos usada na home e em blocos promocionais, com cache longo.',
  })
  @ApiOkResponse({
    description: 'Curadoria famosa retornada com sucesso',
    type: [ComposerListItemDto],
  })
  async findFamous(): Promise<ComposerListItemDto[]> {
    return this.composersService.findFamous();
  }

  @Public()
  @Get('recommended')
  @ApiOperation({
    summary: 'Lista a curadoria recomendada de compositores',
    description:
      'Retorna a lista recomendada usada na home com cache longo e payload enxuto.',
  })
  @ApiOkResponse({
    description: 'Curadoria recomendada retornada com sucesso',
    type: [ComposerListItemDto],
  })
  async findRecommended(): Promise<ComposerListItemDto[]> {
    return this.composersService.findRecommended();
  }

  @Public()
  @Get('featured')
  @ApiOperation({
    summary: 'Retorna o compositor em destaque do dia',
    description:
      'Escolha determinística baseada no dia do ano — todos os visitantes veem o mesmo ' +
      'compositor durante as 24h. Substitui a rota legada `featured-composer`.',
  })
  @ApiOkResponse({
    description: 'Compositor em destaque retornado com sucesso',
    type: FeaturedComposerResponseDto,
  })
  async findFeatured(): Promise<FeaturedComposerResponseDto> {
    return this.composersService.findFeatured();
  }

  @Public()
  @Get(':id/work-type-counts')
  @ApiOperation({
    summary: 'Retorna a contagem de obras do compositor por `workType`',
    description:
      'Usado pelo formulário de envio de obra para mostrar quantas obras de cada tipo ' +
      'o compositor já possui. Substitui a rota legada `composer-work-types`.',
  })
  @ApiOkResponse({
    description: 'Contagens retornadas com sucesso',
    type: ComposerWorkTypeCountsResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  async getWorkTypeCounts(
    @Param('id') id: string,
  ): Promise<ComposerWorkTypeCountsResponseDto> {
    return this.composersService.getWorkTypeCounts(id);
  }

  @Public()
  @Get(':id/works')
  @ApiOperation({
    summary: 'Lista obras de um compositor com filtros e paginação',
    description:
      'Espelha o contrato atual usado em `composer-details.ts`, incluindo busca por movimento, filtro por instrumento, gênero, categoria, tipo e dificuldade.',
  })
  @ApiOkResponse({
    description: 'Obras do compositor retornadas com sucesso',
    type: ComposerWorksResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Parâmetros inválidos no filtro ou paginação',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async findWorks(
    @Param('id') id: string,
    @Query() query: ComposerWorksQueryDto,
  ): Promise<ComposerWorksResponseDto> {
    return this.composersService.findWorks(id, query);
  }

  @Public()
  @Get(':id/filter-options')
  @ApiOperation({
    summary: 'Retorna as opções de filtro disponíveis para um compositor',
    description:
      'Gera os filtros específicos das obras do compositor para popular facetas da página de detalhe sem recalcular no frontend.',
  })
  @ApiOkResponse({
    description: 'Opções de filtro do compositor retornadas com sucesso',
    type: ComposerFilterOptionsResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  async getFilterOptions(
    @Param('id') id: string,
  ): Promise<ComposerFilterOptionsResponseDto> {
    return this.composersService.getFilterOptions(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Retorna o detalhe completo de um compositor',
    description:
      'Expõe o payload completo do detalhe de compositor para futura substituição de `composer-details.ts`, incluindo metadados, verificação e contagem de obras.',
  })
  @ApiOkResponse({
    description: 'Detalhe do compositor retornado com sucesso',
    type: ComposerDetailDto,
  })
  @ApiBadRequestResponse({
    description: 'ID do compositor inválido',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Compositor não encontrado',
    type: ErrorResponseDto,
  })
  async findOne(@Param('id') id: string): Promise<ComposerDetailDto> {
    return this.composersService.findOne(id);
  }

  // Cadastro de compositor: rascunho e tradução de biografia, sem gravar.
  // Exigem login (não são públicas) e contam no mesmo teto diário da IA.
  @Post('biography/draft')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Rascunho de biografia por IA, sem gravar',
    description:
      'Para o cadastro de compositor ainda sem id: gera a partir do que o ' +
      'formulário já tem e devolve o texto, que é salvo junto com o ' +
      'compositor (`bio`/`bioEn` em `POST`/`PATCH /uploads/composer`). ' +
      'Substitui `POST /api/composer/[id]/biography/generate`.',
  })
  @ApiOkResponse({
    description: 'Biografia, ou `status: unavailable`',
    type: BiographyResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Teto diário de gerações atingido',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Nenhum provedor de IA disponível',
    type: ErrorResponseDto,
  })
  draftBiography(@Body() dto: BiographyDraftDto): Promise<BiographyResult> {
    return this.bioService.draft(
      {
        name: dto.name,
        fullName: dto.fullName ?? dto.name,
        alternativeNames: dto.alternativeNames,
        birthDate: dto.birthDate,
        deathDate: dto.deathDate,
        epochName: dto.epochName,
        roleName: dto.roleName,
        nationality: dto.nationality,
        instruments: dto.instruments,
      },
      dto.language ?? 'pt',
    );
  }

  @Post('biography/translate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Traduz uma biografia do português para o inglês, sem gravar',
    description:
      'O texto do formulário, como está (pode não estar salvo). Substitui ' +
      '`POST /api/composer/[id]/biography/translate`, que traduzia pelo ' +
      'Google Tradutor; aqui é a mesma IA da biografia.',
  })
  @ApiOkResponse({ type: TranslatedBiographyDto })
  @ApiTooManyRequestsResponse({
    description: 'Teto diário de gerações atingido',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Nenhum provedor de IA disponível',
    type: ErrorResponseDto,
  })
  async translateBiography(
    @Body() dto: TranslateBiographyDto,
  ): Promise<TranslatedBiographyDto> {
    return { translatedText: await this.bioService.translateText(dto.text) };
  }

  // POST, não GET: pode gerar texto por IA, que custa — e GET é o que robô e
  // prefetch disparam sozinhos.
  @Public()
  @Post(':id/biography')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Biografia do compositor — a gravada ou, faltando, gerada por IA',
    description:
      'Substitui `POST /api/composer/[id]/generate-bio`. Se o compositor não tem ' +
      'biografia no idioma pedido, a IA gera (cascata configurável em ' +
      '`AI_PROVIDER_ORDER`) e grava. Em inglês, traduz a portuguesa. ' +
      '`status: unavailable` = a IA não conhece o compositor; ' +
      '202 com `status: generating` = pergunte de novo em `retryAfter` segundos.',
  })
  @ApiOkResponse({
    description: 'Biografia, ou `status: unavailable`',
    type: BiographyResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Ainda gerando; o texto fica gravado',
    type: BiographyResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'Teto diário de gerações atingido',
    type: ErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Nenhum provedor de IA disponível',
    type: ErrorResponseDto,
  })
  async biography(
    @Param('id') id: string,
    @Body() dto: BiographyRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BiographyResult> {
    const result = await this.bioService.biography(id, dto.language ?? 'pt');

    if (result.biography === null && result.status === 'generating') {
      response.status(HttpStatus.ACCEPTED);
    }

    return result;
  }
}
