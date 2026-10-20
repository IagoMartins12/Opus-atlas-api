import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FinanceDirection } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateFinanceEntryDto,
  CreateFinanceGoalDto,
  FinanceExportQueryDto,
  FinanceMrrQueryDto,
  FinanceMonthQueryDto,
  UpdateFinanceEntryDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

/**
 * O financeiro do painel: custos, entradas manuais, metas, o resumo do mês, a
 * projeção e a exportação. Só o administrador; toda escrita fica na trilha
 * de auditoria, na classe de ações graves (como a cobrança).
 */
@ApiTags('admin-finance')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'O mês: custos, receita, resultado, assinantes, equilíbrio e projeção',
    description:
      'Caixa: pagamentos aprovados no mês. Competência: o MRR de hoje (anual vale 1/12). A projeção são os próximos 12 meses com os recorrentes, as parcelas que faltam e o MRR atual. Dinheiro em centavos de real.',
  })
  @ApiOkResponse({ description: 'O resumo' })
  summary(@Query() query: FinanceMonthQueryDto) {
    return this.service.summary(query.month);
  }

  @Get('mrr')
  @ApiOperation({
    summary: 'O MRR mês a mês: o fim de cada mês e a ponte entre eles',
    description:
      'Do retrato diário do MRR: novo, expansão, contração e cancelamento (a diferença entre dois retratos, assinatura por assinatura). `since` é o dia do primeiro retrato; antes dele não há número.',
  })
  @ApiOkResponse({ description: 'Os meses, do mais antigo ao atual' })
  mrr(@Query() query: FinanceMrrQueryDto) {
    return this.service.mrrSeries(query.months ?? 12);
  }

  @Post('stripe-fees/sync')
  @Audited({ action: 'finance.stripe-fees.sync', entityType: 'finance' })
  @ApiOperation({
    summary: 'Lê no Stripe a taxa dos pagamentos que ainda não a têm',
    description:
      'Em lotes de 25. `pending` é o que ainda falta; chame de novo até zerar.',
  })
  @ApiOkResponse({
    description: 'Quantos foram vistos, atualizados e quantos faltam',
  })
  syncStripeFees() {
    return this.service.syncStripeFees();
  }

  @Get('entries')
  @ApiOperation({ summary: 'Lançamentos de custo ou de entrada manual' })
  @ApiQuery({ name: 'direction', enum: FinanceDirection })
  @ApiOkResponse({ description: 'Os lançamentos, com estado e próxima data' })
  entries(@Query('direction') direction: FinanceDirection) {
    return this.service.listEntries(direction === 'INCOME' ? 'INCOME' : 'COST');
  }

  @Post('entries')
  @Audited({ action: 'finance.entry.create', entityType: 'finance-entry' })
  @ApiOperation({
    summary: 'Lança um custo ou uma entrada',
    description:
      'Em dólar ou euro, sem `fxRate`, usa a PTAX do dia; a cotação fica guardada no lançamento.',
  })
  @ApiOkResponse({ description: 'O lançamento criado' })
  createEntry(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateFinanceEntryDto,
  ) {
    return this.service.createEntry(user.sub, dto);
  }

  @Patch('entries/:id')
  @Audited({
    action: 'finance.entry.update',
    entityType: 'finance-entry',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Corrige um lançamento' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'O lançamento corrigido' })
  updateEntry(@Param('id') id: string, @Body() dto: UpdateFinanceEntryDto) {
    return this.service.updateEntry(id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'finance.entry.delete',
    entityType: 'finance-entry',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Apaga um lançamento' })
  @ApiParam({ name: 'id' })
  @ApiNoContentResponse()
  async removeEntry(@Param('id') id: string): Promise<void> {
    await this.service.removeEntry(id);
  }

  @Post('entries/:id/pause')
  @Audited({
    action: 'finance.entry.pause',
    entityType: 'finance-entry',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Pausa ou encerra um recorrente, sem apagar o histórico',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'O lançamento pausado' })
  pause(@Param('id') id: string) {
    return this.service.setPaused(id, true);
  }

  @Post('entries/:id/resume')
  @Audited({
    action: 'finance.entry.resume',
    entityType: 'finance-entry',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Retoma um recorrente pausado' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'O lançamento retomado' })
  resume(@Param('id') id: string) {
    return this.service.setPaused(id, false);
  }

  @Get('goals')
  @ApiOperation({
    summary: 'Metas com o progresso de hoje',
    description: 'MRR, assinantes e professores ativos, com prazo.',
  })
  @ApiOkResponse({ description: 'As metas' })
  goals() {
    return this.service.listGoals();
  }

  @Post('goals')
  @Audited({ action: 'finance.goal.create', entityType: 'finance-goal' })
  @ApiOperation({ summary: 'Cria uma meta' })
  @ApiOkResponse({ description: 'A meta criada' })
  createGoal(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateFinanceGoalDto,
  ) {
    return this.service.createGoal(user.sub, dto);
  }

  @Delete('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'finance.goal.delete',
    entityType: 'finance-goal',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Apaga uma meta' })
  @ApiParam({ name: 'id' })
  @ApiNoContentResponse()
  async removeGoal(@Param('id') id: string): Promise<void> {
    await this.service.removeGoal(id);
  }

  @Get('export')
  @Audited({ action: 'finance.export', entityType: 'finance' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="financeiro.csv"')
  @ApiOperation({
    summary: 'Exporta as cobranças e entradas manuais de um período em CSV',
  })
  @ApiOkResponse({ description: 'CSV com ponto e vírgula' })
  export(@Query() query: FinanceExportQueryDto) {
    return this.service.exportCsv(query.from, query.to);
  }
}
