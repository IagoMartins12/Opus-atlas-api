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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ExportActivitiesQueryDto,
  ListActivitiesQueryDto,
} from './dto/list-activities-query.dto';
import { SchoolActivitiesService } from './school-activities.service';

/**
 * Trilha de atividade escolar.
 *
 * Registra o que cada lado fez — aula criada, tarefa entregue, perfil alterado
 * — e devolve isso como histórico ao próprio usuário. Não é auditoria
 * administrativa: para isso existe `@Audited()`, que grava em `AdminAuditLog` e
 * responde a outra pergunta (quem, do time, mexeu no quê).
 */
@ApiTags('portal-school-activities')
@ApiBearerAuth('access-token')
@Controller('school-activities')
export class SchoolActivitiesController {
  constructor(private readonly service: SchoolActivitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Trilha de atividade de quem chamou',
    description:
      'Sem `as`, traz os dois lados: quem é aluno e professor tem uma trilha ' +
      'só. As entidades citadas são resolvidas em lote, e `entity` vem `null` ' +
      'quando a original foi removida.',
  })
  @ApiOkResponse({ description: 'Atividades paginadas' })
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Exporta a trilha',
    description:
      'Em JSON ou CSV, limitado a 5.000 registros. O CSV escapa aspas e ' +
      'neutraliza prefixo de fórmula — sem isso, um título de aula podia virar ' +
      'fórmula executável na planilha de quem abrisse o arquivo.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Atividades exportadas' })
  async export(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ExportActivitiesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.export(user.sub, query);

    if (!('csv' in result)) {
      return result;
    }

    const filename = `${query.filename ?? 'atividades'}.csv`;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    // BOM para o Excel reconhecer UTF-8 e não corromper os acentos.
    return `﻿${result.csv}`;
  }
}
