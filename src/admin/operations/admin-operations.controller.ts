import { Controller, Get, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminAuditService } from './admin-audit.service';
import {
  AuditSummaryQueryDto,
  ListAuditQueryDto,
} from './dto/admin-operations.dto';

/**
 * Operação: trilha de auditoria administrativa.
 *
 * **O que o legado tinha aqui não foi portado, e isso é deliberado.**
 * `admin/logs` e `admin/logs/cleanup` liam e apagavam **arquivos de log em
 * disco** — um logger de arquivo que a Etapa 0 substituiu por saída padrão,
 * Sentry e `/api/metrics`. Reconstruir a leitura de arquivos seria reconstruir
 * o que foi deliberadamente removido, e junto viria a falha que ela carregava
 * (ver `ROADMAP`, fatia 8).
 *
 * O que sobra dessa área, e é o que um administrador realmente precisa, é
 * **quem fez o quê** — que agora vive em `AdminAuditLog`, alimentado pelo
 * `@Audited()` desde a primeira fatia do Admin.
 */
@ApiTags('admin-operations')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/audit')
export class AdminOperationsController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Trilha de ações administrativas',
    description:
      'Registra sucesso **e** tentativa negada — `onlyFailures=true` é o filtro ' +
      'que interessa numa investigação. O nome de quem agiu é resolvido em ' +
      'lote; se a conta foi removida, o id permanece e o nome vem nulo.',
  })
  @ApiOkResponse({ description: 'Registros paginados' })
  async list(@Query() query: ListAuditQueryDto) {
    return this.audit.list(query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Resumo do período',
    description: 'O que mais aconteceu, quem mais agiu e quanto foi recusado.',
  })
  @ApiOkResponse({ description: 'Totais, taxa de falha e concentração' })
  async summary(@Query() query: AuditSummaryQueryDto) {
    return this.audit.summary(query);
  }

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audited({ action: 'audit.export', entityType: 'adminAuditLog' })
  @ApiOperation({
    summary: 'Exporta a trilha',
    description:
      'Exportar a auditoria é, ela própria, uma ação auditada — quem levou a ' +
      'trilha embora precisa aparecer na trilha.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Registros exportados' })
  async export(
    @Query() query: ListAuditQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.audit.export(query);

    if (!('csv' in result)) {
      return result;
    }

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`,
    );

    return `﻿${result.csv}`;
  }
}
