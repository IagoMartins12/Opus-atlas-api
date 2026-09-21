import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
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
  AddLearnedDto,
  LearnedActionResponseDto,
  LearnedListResponseDto,
  LearnedStatusResponseDto,
  UpdateLearnedDto,
} from './dto/learned.dto';
import { LearningService } from './learning.service';

@ApiTags('library-learning')
@ApiBearerAuth('access-token')
@ApiExtraModels(LearnedListResponseDto, LearnedStatusResponseDto)
@Controller('learning/learned')
export class LearnedController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista as obras já aprendidas do usuário, ou verifica uma específica',
    description:
      'O upload de vídeo de performance do fluxo legado ainda não foi portado — fica para ' +
      'o futuro `UploadsModule` (seção 3.11.7 da SPEC.md). Os campos de vídeo são aceitos no ' +
      'contrato de resposta mas sempre retornam `null` por enquanto.',
  })
  @ApiQuery({ name: 'workId', required: false })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(LearnedListResponseDto) },
        { $ref: getSchemaPath(LearnedStatusResponseDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async find(
    @CurrentUser() user: AccessTokenPayload,
    @Query('workId') workId?: string,
  ) {
    return this.learningService.getLearned(user.sub, workId);
  }

  @Post()
  @ApiOperation({
    summary: 'Adiciona ou remove uma obra da lista de "já aprendi"',
    description:
      'Adicionar remove automaticamente a obra da lista "quero aprender" (as duas listas ' +
      'são mutuamente exclusivas).',
  })
  @ApiOkResponse({ type: LearnedActionResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async addOrRemove(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: AddLearnedDto,
  ) {
    return this.learningService.addOrRemoveLearned(user.sub, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Atualiza os dados de um item já aprendido' })
  @ApiOkResponse({ type: LearnedActionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateLearnedDto,
  ) {
    return this.learningService.updateLearned(user.sub, dto);
  }
}
