import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { AdminUsersService } from './admin-users.service';
import {
  AdminUserAnalyticsQueryDto,
  ExportAdminUsersQueryDto,
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

/**
 * Administração de usuários.
 *
 * **Uma rota por operação.** O legado tinha um `GET` só que despachava por
 * `?action=list|analytics|export` — três respostas de formatos distintos na
 * mesma URL, impossíveis de documentar, cachear ou limitar separadamente.
 *
 * Exige `SUPER_ADMIN`, como no legado (`role !== 2` respondia 401). A escrita é
 * auditada: `@Audited()` grava em `AdminAuditLog` tanto o sucesso quanto a
 * tentativa negada.
 */
@ApiTags('admin-users')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista usuários com filtros' })
  @ApiOkResponse({ description: 'Usuários paginados, com contagens' })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async list(@Query() query: ListAdminUsersQueryDto) {
    return this.service.list(query);
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Números da base de usuários',
    description:
      'Sem cache de processo: o do legado era por instância e não sobrevive a ' +
      'mais de um nó.',
  })
  @ApiOkResponse({ description: 'Totais, crescimento e distribuição' })
  async analytics(@Query() query: AdminUserAnalyticsQueryDto) {
    return this.service.analytics(query);
  }

  @Get('export')
  @Audited({ action: 'user.export', entityType: 'user' })
  @ApiOperation({
    summary: 'Exporta a base de usuários',
    description:
      'CSV ou JSON, até 10.000 registros. Exportar dado pessoal em massa é ' +
      'ação auditada.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Usuários exportados' })
  async export(
    @Query() query: ExportAdminUsersQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.export(query);

    if (!('csv' in result)) {
      return result;
    }

    const filename = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`;

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    // BOM para o Excel reconhecer UTF-8.
    return `﻿${result.csv}`;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe de um usuário',
    description:
      'A projeção é declarada campo a campo. O legado usava `include`, que traz ' +
      'todo escalar de `User` — hash de senha incluído — para a memória.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Usuário, perfis e contagens' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Audited({ action: 'user.update', entityType: 'user', entityIdParam: 'id' })
  @ApiOperation({
    summary: 'Altera papel e marcas de um usuário',
    description:
      'Valor de `role` validado; ninguém rebaixa a si mesmo; o último super ' +
      'admin não pode ser rebaixado; e o perfil de professor muda na mesma ' +
      'transação que a conta.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Usuário atualizado' })
  @ApiBadRequestResponse({
    description: 'Corpo vazio ou fora do domínio',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Autorrebaixamento, ou último super admin',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }
}
