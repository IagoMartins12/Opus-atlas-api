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
import { ComposerUploadsService } from './composer-uploads.service';
import { CheckComposerDuplicateDto } from './dto/check-composer-duplicate.dto';
import { ComposerDuplicateResponseDto } from './dto/composer-duplicate-response.dto';
import {
  ComposerCascadeInfoDto,
  ComposerUploadResponseDto,
} from './dto/composer-upload-response.dto';
import { CreateComposerContributionDto } from './dto/create-composer-contribution.dto';
import { UpdateComposerContributionDto } from './dto/update-composer-contribution.dto';

/** Papel de moderador no schema legado. */
const ADMIN_ROLE = 2;

@ApiTags('uploads-composers')
@ApiBearerAuth('access-token')
@Controller('uploads/composer')
export class ComposerUploadsController {
  constructor(private readonly service: ComposerUploadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Cadastro cria conteúdo público; sem limite, um script poderia poluir o
  // catálogo mais rápido do que a moderação consegue revisar.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cadastra um compositor enviado pela comunidade',
    description:
      'Só os campos declarados no DTO são gravados. Campos de curadoria ' +
      '(`isVerified`, `verifiedBy`, `dataQuality`) são definidos pelo servidor e ' +
      'não podem ser enviados pelo cliente.',
  })
  @ApiCreatedResponse({
    description: 'Compositor cadastrado',
    type: ComposerUploadResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Época ou papel inexistente, ou payload inválido',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateComposerContributionDto,
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
    summary: 'Verifica se o compositor já existe antes do cadastro',
    description:
      'Procura pelo link de origem e por grafias alternativas do nome — ' +
      '"Mozart, Wolfgang Amadeus", "W. A. Mozart" e "Wolfgang Amadeus Mozart" ' +
      'são reconhecidos como a mesma pessoa.',
  })
  @ApiOkResponse({ type: ComposerDuplicateResponseDto })
  async checkDuplicate(
    @Body() dto: CheckComposerDuplicateDto,
  ): Promise<ComposerDuplicateResponseDto> {
    return this.service.checkDuplicate(dto);
  }

  @Get(':id/cascade-info')
  @ApiOperation({
    summary: 'Mostra o que será apagado junto com o compositor',
    description:
      'A exclusão em cascata derruba obras, partituras e anotações associadas. ' +
      'Este endpoint existe para a confirmação mostrar o alcance real antes.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'O compositor, as obras que vão junto e a contagem do resto',
    type: ComposerCascadeInfoDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async cascadeInfo(@Param('id') id: string) {
    return this.service.cascadeInfo(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Carrega um compositor para edição',
    description: 'Só quem enviou, ou admin.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: ComposerUploadResponseDto })
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
    summary: 'Edita um compositor que o próprio usuário cadastrou',
    description:
      'Usuário comum só altera o que enviou. Moderador altera qualquer um. ' +
      'Campos não enviados permanecem intactos.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Compositor atualizado',
    type: ComposerUploadResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'O compositor foi cadastrado por outra pessoa',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateComposerContributionDto,
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
    summary: 'Remove um compositor cadastrado pelo próprio usuário',
    description:
      'Os arquivos associados saem do armazenamento antes do registro do banco. ' +
      'Consulte `cascade-info` primeiro para saber o alcance.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Compositor removido' })
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
