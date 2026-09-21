import {
  Body,
  Controller,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { Audited } from '../../common/audit/audit.decorator';
import { UploadHistoryService } from '../shared/upload-history.service';
import {
  ListModerationQueryDto,
  ModerationStatsQueryDto,
} from './dto/list-moderation-query.dto';
import { ReportUploadDto } from './dto/report-upload.dto';
import { ResolveModerationDto } from './dto/resolve-moderation.dto';
import {
  ModerationBulkResultDto,
  ModerationQueueDto,
  ModerationReportDto,
  ModerationStatsDto,
} from './dto/moderation-response.dto';
import {
  MAX_BULK_MODERATION,
  ResolveModerationBulkDto,
} from './dto/resolve-moderation-bulk.dto';
import { ModerationService } from './moderation.service';

@ApiTags('uploads-moderation')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  // Denúncia é gratuita para quem envia e cara para quem revisa: sem limite, um
  // usuário sozinho consegue afundar a fila de moderação.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Denuncia um conteúdo enviado pela comunidade',
    description:
      'Aberto a qualquer usuário autenticado. A mesma pessoa não pode denunciar ' +
      'o mesmo item duas vezes enquanto a primeira denúncia estiver pendente.',
  })
  @ApiCreatedResponse({
    description: 'Denúncia registrada',
    type: ModerationReportDto,
  })
  @ApiNotFoundResponse({
    description: 'Conteúdo denunciado não encontrado',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Você já denunciou este item',
    type: ErrorResponseDto,
  })
  async report(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ReportUploadDto,
    @Req() request: Request,
  ) {
    return this.service.report(
      user.sub,
      dto,
      UploadHistoryService.contextFrom(request),
    );
  }

  // **RN-4 decidida: modera quem é `ADMIN` ou acima.** O legado exigia
  // `role !== 2` (super admin), e manter isso significava que a fila só andava
  // quando uma pessoa específica sentasse nela — o que é o contrário de ter
  // prazo. Toda decisão continua nominal e auditada (`moderatedBy`,
  // `AdminAuditLog`), e remover conteúdo exige justificativa escrita. Um papel
  // `MODERATOR` separado, que não veja usuário nem cobrança, é o passo
  // seguinte e está registrado no ROADMAP.
  @Get('moderation')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Lista a fila de moderação',
    description:
      'Cada denúncia vem com o conteúdo denunciado já resolvido, para a tela não ' +
      'precisar de uma chamada por item.',
  })
  @ApiOkResponse({
    description: 'Denúncias paginadas',
    type: ModerationQueueDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async list(@Query() query: ListModerationQueryDto) {
    return this.service.list(query);
  }

  @Get('moderation/stats')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Números da fila de moderação',
    description:
      'Por estado, pendentes por prioridade e tipo, vencidas pelo prazo da ' +
      'RN-4, e o período: denunciadas, resolvidas e tempo médio de resolução.',
  })
  @ApiOkResponse({ type: ModerationStatsDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async stats(@Query() query: ModerationStatsQueryDto) {
    return this.service.stats(query.days);
  }

  @Patch('moderation/:id')
  @Roles('ADMIN')
  @Audited({
    action: 'moderation.resolve',
    entityType: 'uploadModeration',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Resolve uma denúncia',
    description:
      '`delete` remove o conteúdo denunciado e também os arquivos associados no ' +
      'armazenamento — antes o arquivo seguia acessível por URL direta mesmo ' +
      'depois de o registro sair do banco.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({
    description: 'Denúncia resolvida',
    type: ModerationReportDto,
  })
  @ApiBadRequestResponse({
    description: 'Denúncia já processada',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async resolve(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ResolveModerationDto,
  ) {
    return this.service.resolve(user.sub, id, dto);
  }

  @Patch('moderation')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'moderation.resolveMany',
    entityType: 'uploadModeration',
  })
  @ApiOperation({
    summary: 'Resolve várias denúncias com a mesma ação',
    description:
      'Aplica a resolução singular a cada denúncia, então o efeito é idêntico ' +
      'ao de resolvê-las uma a uma — inclusive a remoção dos arquivos e a ' +
      'invalidação do cache, que a rota de lote do legado não fazia. Uma falha ' +
      'não derruba as outras: cada denúncia vira uma linha de resultado. ' +
      `Máximo de ${MAX_BULK_MODERATION} por chamada.`,
  })
  @ApiOkResponse({
    description: 'Quantas foram resolvidas, quantas falharam e por quê',
    type: ModerationBulkResultDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async resolveMany(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ResolveModerationBulkDto,
  ) {
    return this.service.resolveMany(user.sub, dto.moderationIds, dto);
  }
}
