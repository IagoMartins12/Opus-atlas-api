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
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { UploadHistoryService } from '../shared/upload-history.service';
import { CheckWorkDuplicateDto } from './dto/check-work-duplicate.dto';
import { CreateWorkContributionDto } from './dto/create-work-contribution.dto';
import { UpdateWorkContributionDto } from './dto/update-work-contribution.dto';
import { WorkDuplicateResponseDto } from './dto/work-duplicate-response.dto';
import {
  WorkCascadeInfoDto,
  WorkUploadResponseDto,
} from './dto/work-upload-response.dto';
import { WorkUploadsService } from './work-uploads.service';

const ADMIN_ROLE = 2;

@ApiTags('uploads-works')
@ApiBearerAuth('access-token')
@Controller('uploads/work')
export class WorkUploadsController {
  constructor(private readonly service: WorkUploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cadastra uma obra enviada pela comunidade',
    description:
      'Só os campos declarados no DTO são gravados. Campos de verificação são ' +
      'definidos pelo servidor e não podem vir do cliente.',
  })
  @ApiCreatedResponse({
    description: 'Obra cadastrada',
    type: WorkUploadResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Compositor, instrumento ou época inexistente',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateWorkContributionDto,
    @Req() request: Request,
  ) {
    return this.service.create(
      user.sub,
      dto,
      UploadHistoryService.contextFrom(request),
    );
  }

  @Post('check-duplicate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verifica se a obra já existe antes do cadastro',
    description:
      'Checa pelo link do IMSLP e pelo par título + compositor. O par é o que ' +
      'pega a duplicata digitada à mão.',
  })
  @ApiOkResponse({ type: WorkDuplicateResponseDto })
  @ApiBadRequestResponse({
    description: 'Informe a URL, ou o título junto com o compositor',
    type: ErrorResponseDto,
  })
  async checkDuplicate(
    @Body() dto: CheckWorkDuplicateDto,
  ): Promise<WorkDuplicateResponseDto> {
    return this.service.checkDuplicate(dto);
  }

  @Get(':id/cascade-info')
  @ApiOperation({
    summary: 'Mostra o que será apagado junto com a obra',
    description:
      'Inclui partituras, anotações, favoritos e listas de estudo de outros ' +
      'usuários que referenciam esta obra.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'A obra, as partituras que vão junto e a contagem do resto',
    type: WorkCascadeInfoDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async cascadeInfo(@Param('id') id: string) {
    return this.service.cascadeInfo(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Carrega uma obra para edição',
    description: 'Só quem enviou, ou admin.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: WorkUploadResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  findForEdit(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.service.findForEdit(id, user.sub, user.role === ADMIN_ROLE);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma obra que o próprio usuário cadastrou' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Obra atualizada',
    type: WorkUploadResponseDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWorkContributionDto,
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
  @ApiOperation({ summary: 'Remove uma obra cadastrada pelo próprio usuário' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Obra removida' })
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
