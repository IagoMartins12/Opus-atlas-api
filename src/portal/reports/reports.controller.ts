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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { ProgressReportQueryDto } from './dto/report-query.dto';
import {
  CreateReportCommentDto,
  ListSharedReportsQueryDto,
  ShareReportDto,
  UpdateSharedReportDto,
} from './dto/share-report.dto';
import { ProgressReportService } from './progress-report.service';
import { SharedReportsService } from './shared-reports.service';

/**
 * Relatórios de progresso.
 *
 * Duas superfícies: a geração, que é do professor e nunca é gravada; e o
 * compartilhamento, que congela um relatório gerado **pelo servidor** e o
 * entrega ao aluno.
 *
 * A separação importa porque no legado o compartilhamento aceitava o conteúdo
 * pronto vindo do cliente — quem chamasse a rota escolhia os números que o
 * aluno leria sobre o próprio aprendizado.
 */
@ApiTags('portal-reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ProgressReportService,
    private readonly shared: SharedReportsService,
  ) {}

  @Get('progress/:studentId')
  // Cada relatório varre aulas, tarefas e repertório do período.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Gera o relatório de progresso de um aluno',
    description:
      'Exige vínculo ativo e aceito — o legado só conferia que a linha do ' +
      'vínculo existia, então professor com convite recusado ou vínculo ' +
      'encerrado continuava puxando o relatório completo. `coverage.truncated` ' +
      'avisa quando o período tem mais registros que o teto de carga.',
  })
  @ApiParam({ name: 'studentId', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Relatório gerado' })
  @ApiBadRequestResponse({
    description: 'Período inválido, invertido, ou acima do teto',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Sem vínculo ativo com o aluno',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async generate(
    @CurrentUser() user: AccessTokenPayload,
    @Param('studentId') studentId: string,
    @Query() query: ProgressReportQueryDto,
  ) {
    return this.reports.generate(user.sub, studentId, query);
  }

  @Post('shared')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Compartilha um relatório com o aluno',
    description:
      'O corpo diz **o que** relatar — aluno, período, seções — e o servidor ' +
      'gera o conteúdo. Nunca é público: o relatório traz presença, engajamento ' +
      'e observações sobre uma pessoa.',
  })
  @ApiCreatedResponse({ description: 'Relatório compartilhado' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async share(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ShareReportDto,
  ) {
    return this.shared.share(user.sub, dto);
  }

  @Get('shared')
  @ApiOperation({
    summary: 'Lista os relatórios compartilhados',
    description:
      'O aluno vê só os ativos e dentro da validade; o professor vê todos os ' +
      'que criou, porque é ele quem os administra.',
  })
  @ApiOkResponse({ description: 'Relatórios paginados' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListSharedReportsQueryDto,
  ) {
    return this.shared.list(user.sub, query);
  }

  @Get('shared/:id')
  @ApiOperation({
    summary: 'Abre um relatório compartilhado',
    description:
      'O professor autor também pode abrir — no legado só o aluno conseguia, e ' +
      'quem compartilhou não revia o que tinha enviado. A visualização só é ' +
      'contada quando quem abre é o aluno.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Relatório completo' })
  @ApiGoneResponse({
    description: 'Relatório revogado ou expirado',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.shared.findOne(user.sub, id);
  }

  @Patch('shared/:id')
  @ApiOperation({ summary: 'Edita o compartilhamento' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Compartilhamento atualizado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSharedReportDto,
  ) {
    return this.shared.update(user.sub, id, dto);
  }

  @Delete('shared/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoga o compartilhamento',
    description:
      'Desativa em vez de apagar: o histórico do que foi enviado ao aluno ' +
      'continua existindo para as duas partes.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Compartilhamento revogado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async revoke(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.shared.revoke(user.sub, id);
  }

  @Get('shared/:id/comments')
  @ApiOperation({
    summary: 'Comentários do relatório',
    description:
      'Paginados. Abrir como professor marca os comentários do aluno como lidos.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Comentários' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async listComments(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Query('page') page?: string,
  ) {
    return this.shared.listComments(user.sub, id, Number(page) || 1);
  }

  @Post('shared/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Comenta o relatório',
    description:
      'Só o aluno dono, e só quando o professor liberou. O professor é ' +
      'notificado — no legado o comentário era gravado sem avisar ninguém.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiCreatedResponse({ description: 'Comentário registrado' })
  @ApiForbiddenResponse({
    description: 'Comentários não liberados neste relatório',
    type: ErrorResponseDto,
  })
  @ApiGoneResponse({
    description: 'Relatório revogado ou expirado',
    type: ErrorResponseDto,
  })
  async addComment(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateReportCommentDto,
  ) {
    return this.shared.addComment(user.sub, id, dto);
  }
}
