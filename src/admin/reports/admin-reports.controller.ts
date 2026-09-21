import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminReportsService } from './admin-reports.service';
import { GenerateReportDto } from './dto/admin-reports.dto';

/**
 * Relatórios do painel em CSV — substitui `GET/POST/DELETE /api/admin/reports`.
 *
 * `SUPER_ADMIN`, como no legado (`role !== 2`). Cada administrador vê e apaga
 * só os relatórios que gerou, também como no legado.
 */
@ApiTags('admin-reports')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly service: AdminReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Números do topo da tela e os relatórios já gerados',
    description: 'Os 50 mais recentes do próprio administrador.',
  })
  @ApiOkResponse({ description: '`{ stats, results }`' })
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.service.list(user.sub);
  }

  @Post()
  // Cada relatório agrupa coleções inteiras; em série, pesaria no banco.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({ action: 'report.generate', entityType: 'generatedReport' })
  @ApiOperation({
    summary: 'Gera um relatório',
    description:
      'Tipos: `users-overview`, `content-analysis`, `engagement-metrics`. ' +
      'Períodos: `7d`, `30d`, `90d`, `1y`. Sempre CSV. Falha na geração volta ' +
      'como relatório com `status: failed` e o motivo.',
  })
  @ApiCreatedResponse({ description: 'O relatório, com `downloadUrl`' })
  generate(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: GenerateReportDto,
  ) {
    return this.service.generate(user.sub, dto.type, dto.period);
  }

  @Get(':id/download')
  @Audited({ action: 'report.download', entityType: 'generatedReport' })
  @ApiOperation({
    summary: 'Baixa o relatório em CSV',
    description:
      'UTF-8 com BOM, para o Excel reconhecer os acentos. Relatório gerado ' +
      'pelo sistema antigo não tem retrato neste formato: responde 404.',
  })
  @ApiParam({ name: 'id' })
  @ApiProduces('text/csv')
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async download(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { filename, csv } = await this.service.download(user.sub, id);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
    );

    return `﻿${csv}`;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ action: 'report.delete', entityType: 'generatedReport' })
  @ApiOperation({ summary: 'Apaga um relatório' })
  @ApiParam({ name: 'id' })
  @ApiNoContentResponse({ description: 'Apagado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(user.sub, id);
  }
}
