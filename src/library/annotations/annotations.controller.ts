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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AnnotationsService } from './annotations.service';
import {
  AnnotationListResponseDto,
  AnnotationResponseDto,
  AnnotationVoteResponseDto,
} from './dto/annotation.dto';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { ListAnnotationsQueryDto } from './dto/list-annotations-query.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';
import { VoteAnnotationDto } from './dto/vote-annotation.dto';

@ApiTags('library-annotations')
@Controller('annotations')
export class AnnotationsController {
  constructor(private readonly annotationsService: AnnotationsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiOperation({
    summary: 'Lista anotações públicas de obras (com filtros e busca)',
    description:
      'Endpoint público. Quando chamado com um access token válido, cada anotação retorna ' +
      '`userVote` (útil/não útil/sem voto) referente ao chamador.',
  })
  @ApiOkResponse({ type: AnnotationListResponseDto })
  async findAll(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Query() query: ListAnnotationsQueryDto,
  ): Promise<AnnotationListResponseDto> {
    return this.annotationsService.findAll(query, user?.sub);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cria uma nova anotação sobre uma obra' })
  @ApiOkResponse({ type: AnnotationResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAnnotationDto,
  ): Promise<AnnotationResponseDto> {
    return this.annotationsService.create(user.sub, dto);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':annotationId')
  @ApiOperation({ summary: 'Busca uma anotação específica' })
  @ApiParam({ name: 'annotationId' })
  @ApiOkResponse({ type: AnnotationResponseDto })
  @ApiNotFoundResponse({
    description:
      'Anotação não encontrada (ou privada e o chamador não é o autor)',
    type: ErrorResponseDto,
  })
  async findOne(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('annotationId') annotationId: string,
  ): Promise<AnnotationResponseDto> {
    return this.annotationsService.findOne(annotationId, user?.sub);
  }

  @Patch(':annotationId')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Atualiza uma anotação (somente o autor)' })
  @ApiParam({ name: 'annotationId' })
  @ApiOkResponse({ type: AnnotationResponseDto })
  @ApiNotFoundResponse({
    description: 'Anotação não encontrada ou sem permissão',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('annotationId') annotationId: string,
    @Body() dto: UpdateAnnotationDto,
  ): Promise<AnnotationResponseDto> {
    return this.annotationsService.update(annotationId, user.sub, dto);
  }

  @Delete(':annotationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove uma anotação (somente o autor)' })
  @ApiParam({ name: 'annotationId' })
  @ApiNoContentResponse({ description: 'Anotação removida com sucesso' })
  @ApiNotFoundResponse({
    description: 'Anotação não encontrada ou sem permissão',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('annotationId') annotationId: string,
  ): Promise<void> {
    await this.annotationsService.remove(annotationId, user.sub);
  }

  @Post(':annotationId/vote')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Vota se uma anotação é útil ou não',
    description:
      'Votar de novo com o mesmo valor desfaz o voto. Votar com valor diferente troca o voto. ' +
      'Não é possível votar na própria anotação nem em anotações privadas.',
  })
  @ApiParam({ name: 'annotationId' })
  @ApiOkResponse({ type: AnnotationVoteResponseDto })
  @ApiBadRequestResponse({
    description: 'Tentativa de votar na própria anotação',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Anotação privada não aceita votos',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async vote(
    @CurrentUser() user: AccessTokenPayload,
    @Param('annotationId') annotationId: string,
    @Body() dto: VoteAnnotationDto,
  ): Promise<AnnotationVoteResponseDto> {
    return this.annotationsService.vote(annotationId, user.sub, dto.isHelpful);
  }
}
