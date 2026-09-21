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
  AddWantToLearnDto,
  UpdateWantToLearnDto,
  WantToLearnActionResponseDto,
  WantToLearnListResponseDto,
  WantToLearnStatusResponseDto,
} from './dto/want-to-learn.dto';
import { LearningService } from './learning.service';

@ApiTags('library-learning')
@ApiBearerAuth('access-token')
@ApiExtraModels(WantToLearnListResponseDto, WantToLearnStatusResponseDto)
@Controller('learning/want-to-learn')
export class WantToLearnController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista a lista de estudo do usuário, ou verifica uma obra específica',
  })
  @ApiQuery({ name: 'workId', required: false })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(WantToLearnListResponseDto) },
        { $ref: getSchemaPath(WantToLearnStatusResponseDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async find(
    @CurrentUser() user: AccessTokenPayload,
    @Query('workId') workId?: string,
  ) {
    return this.learningService.getWantToLearn(user.sub, workId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Adiciona ou remove uma obra da lista de estudo ("quero aprender")',
    description:
      'Adicionar remove automaticamente a obra da lista de "já aprendi" (as duas listas ' +
      'são mutuamente exclusivas).',
  })
  @ApiOkResponse({ type: WantToLearnActionResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Obra não encontrada',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async addOrRemove(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: AddWantToLearnDto,
  ) {
    return this.learningService.addOrRemoveWantToLearn(user.sub, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Atualiza os dados de um item da lista de estudo' })
  @ApiOkResponse({ type: WantToLearnActionResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateWantToLearnDto,
  ) {
    return this.learningService.updateWantToLearn(user.sub, dto);
  }
}
