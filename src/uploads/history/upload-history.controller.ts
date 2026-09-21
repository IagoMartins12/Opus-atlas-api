import { Controller, Get, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  ExportHistoryQueryDto,
  ListHistoryQueryDto,
} from './dto/list-history-query.dto';
import { ListMyUploadsQueryDto } from './dto/list-my-uploads-query.dto';
import { MyUploadsResponseDto } from './dto/my-uploads-response.dto';
import {
  ContributionTotalsDto,
  UploadHistoryEntryDto,
  UploadHistoryExportDto,
  UploadHistoryListDto,
  UploadHistoryStatsDto,
} from './dto/upload-history-response.dto';
import { UploadHistoryQueryService } from './upload-history-query.service';

const MODERATOR_ROLE = 2;

@ApiTags('uploads-history')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class UploadHistoryController {
  constructor(private readonly service: UploadHistoryQueryService) {}

  @Get('mine')
  @ApiOperation({
    summary: 'Meus envios',
    description:
      'Os compositores, obras e partituras que quem chamou criou — com busca, ' +
      'filtros, paginação e a contagem de cada tipo. É a página "Meus uploads" ' +
      'do front.',
  })
  @ApiOkResponse({ type: MyUploadsResponseDto })
  async listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListMyUploadsQueryDto,
  ): Promise<MyUploadsResponseDto> {
    return this.service.listMine(user.sub, query);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Histórico de contribuições do usuário',
    description:
      'Por padrão devolve as contribuições de quem chamou. Consultar as de outro ' +
      'usuário exige papel de moderação.',
  })
  @ApiOkResponse({
    description: 'Histórico paginado',
    type: UploadHistoryListDto,
  })
  @ApiForbiddenResponse({
    description: 'Tentativa de ler o histórico de outro usuário sem permissão',
    type: ErrorResponseDto,
  })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListHistoryQueryDto,
  ) {
    return this.service.list(user.sub, user.role === MODERATOR_ROLE, query);
  }

  @Get('history/export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exporta o histórico de contribuições',
    description:
      'Os mesmos filtros da listagem, até 5.000 registros, em JSON ou CSV ' +
      '(`format`). Sem IP nem navegador. O CSV neutraliza prefixo de fórmula.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description: 'Em `format=json`; em `format=csv` a resposta é o arquivo',
    type: UploadHistoryExportDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async export(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ExportHistoryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.export(
      user.sub,
      user.role === MODERATOR_ROLE,
      query,
      query.format ?? 'json',
    );

    if (!('csv' in result)) {
      return result;
    }

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="historico-de-contribuicoes.csv"',
    );

    // BOM para o Excel reconhecer UTF-8 e não corromper os acentos.
    return `\uFEFF${result.csv}`;
  }

  @Get('history/recent')
  @ApiOperation({ summary: 'Últimas contribuições do usuário' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiOkResponse({
    description: 'Contribuições mais recentes',
    type: [UploadHistoryEntryDto],
  })
  async recent(
    @CurrentUser() user: AccessTokenPayload,
    @Query('limit') limit?: string,
  ) {
    return this.service.recent(user.sub, limit ? Number(limit) : 10);
  }

  @Get('history/stats')
  @ApiOperation({
    summary: 'Estatísticas do histórico de contribuições',
    description: 'Totais por período, por tipo de entidade e por ação.',
  })
  @ApiOkResponse({
    description: 'Estatísticas do usuário',
    type: UploadHistoryStatsDto,
  })
  async stats(@CurrentUser() user: AccessTokenPayload) {
    return this.service.stats(user.sub);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Totais de contribuições publicadas pelo usuário',
    description:
      'Diferente de `history/stats`: aqui conta o que está publicado agora. ' +
      'Apagar uma obra reduz este total, mas a linha de histórico do envio permanece.',
  })
  @ApiOkResponse({ description: 'Totais atuais', type: ContributionTotalsDto })
  async contributionTotals(@CurrentUser() user: AccessTokenPayload) {
    return this.service.contributionTotals(user.sub);
  }
}
