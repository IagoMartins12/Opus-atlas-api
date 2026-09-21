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
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UploadHistoryService } from '../shared/upload-history.service';
import { CreateScoreContributionDto } from './dto/create-score-contribution.dto';
import { UpdateScoreContributionDto } from './dto/update-score-contribution.dto';
import {
  ScoreGroupsResponseDto,
  ScoreUploadResponseDto,
} from './dto/score-upload-response.dto';
import { ScoreUploadsService } from './score-uploads.service';

const ADMIN_ROLE = 2;

@ApiTags('uploads-scores')
@ApiBearerAuth('access-token')
@Controller('uploads/score')
export class ScoreUploadsController {
  constructor(private readonly service: ScoreUploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Registra uma partitura enviada pela comunidade',
    description:
      'O arquivo sobe antes por `POST /uploads/file` com `kind=SCORE_FILE`; aqui ' +
      'entra apenas o `assetId` devolvido. A partitura é gravada com origem ' +
      '`UPLOAD`, que a distingue dos links externos do IMSLP.',
  })
  @ApiCreatedResponse({
    description: 'Partitura registrada',
    type: ScoreUploadResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Obra inexistente, arquivo de outro usuário ou já associado',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateScoreContributionDto,
    @Req() request: Request,
  ) {
    return this.service.create(
      user.sub,
      dto,
      UploadHistoryService.contextFrom(request),
    );
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Grupos de partitura da obra e sugestão de encaixe',
    description:
      'Para a tela de envio sugerir grupo e índice da partitura nova.',
  })
  @ApiQuery({ name: 'workId', required: true })
  @ApiOkResponse({ type: ScoreGroupsResponseDto })
  groups(
    @CurrentUser() user: AccessTokenPayload,
    @Query('workId') workId: string,
  ) {
    return this.service.groups(workId, user.sub);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Carrega uma partitura para edição',
    description: 'Só quem enviou, ou admin.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: ScoreUploadResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findForEdit(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.service.findForEdit(id, user.sub, user.role === ADMIN_ROLE);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edita os metadados de uma partitura enviada pelo próprio usuário',
    description:
      'A obra e o arquivo não podem ser trocados. Para substituir o arquivo, ' +
      'envie uma partitura nova e remova a antiga.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Partitura atualizada',
    type: ScoreUploadResponseDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateScoreContributionDto,
    @Req() request: Request,
  ) {
    return this.service.update(
      user.sub,
      user.role === ADMIN_ROLE,
      id,
      dto,
      UploadHistoryService.contextFrom(request),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove uma partitura enviada pelo próprio usuário',
    description: 'O arquivo sai do armazenamento junto com o registro.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Partitura removida' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.remove(
      user.sub,
      user.role === ADMIN_ROLE,
      id,
      UploadHistoryService.contextFrom(request),
    );
  }
}
