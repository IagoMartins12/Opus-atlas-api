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
  AdminUserItemsQueryDto,
  ExportAdminUsersQueryDto,
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
  UpdateGrantedPlanDto,
  UpdateTeacherInvitationDto,
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

  @Get('overview')
  @ApiOperation({
    summary: 'Resumo da base: chegada, retorno, cadastro, uso e pagantes',
  })
  @ApiOkResponse({ description: 'Contagens da base de usuários' })
  async overview() {
    return this.service.overview();
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

  @Get(':id/items')
  @ApiOperation({
    summary:
      'O que a conta guardou ou fez: favoritos, aprendidas, quero aprender, anotações, envios, arquivos',
  })
  @ApiParam({ name: 'id', description: 'Id do usuário' })
  @ApiOkResponse({ description: 'Itens paginados, num formato só' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async items(@Param('id') id: string, @Query() query: AdminUserItemsQueryDto) {
    return this.service.items(id, query);
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

  @Patch(':id/teacher-invitation')
  @Audited({
    action: 'user.teacher-invitation.update',
    entityType: 'user',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Muda o convite de professor ainda sem resposta',
    description:
      'Plano oferecido (Mentor ou Maestro), vencimento do plano e validade ' +
      'do convite. Sem `resend`, o link do e-mail continua o mesmo; com ele, ' +
      'saem links novos e outro e-mail.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Usuário, com o convite atualizado' })
  @ApiBadRequestResponse({
    description: 'Data no passado ou plano ausente',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Nenhum convite pendente',
    type: ErrorResponseDto,
  })
  async updateTeacherInvitation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTeacherInvitationDto,
  ) {
    return this.service.updateTeacherInvitation(user.sub, id, dto);
  }

  @Patch(':id/granted-plan')
  @Audited({
    action: 'subscription.grant',
    entityType: 'user',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Muda ou concede o plano dado pela equipe',
    description:
      'Troca Mentor ↔ Maestro e o vencimento (nulo: sem vencimento). Sem ' +
      'plano concedido em vigor, concede um. Assinatura paga pelo Stripe é ' +
      'recusada: ela muda pela própria assinatura.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Usuário, com a assinatura atualizada' })
  @ApiBadRequestResponse({
    description:
      'Vencimento no passado, plano ausente, ou conta paga pelo Stripe',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateGrantedPlan(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGrantedPlanDto,
  ) {
    return this.service.updateGrantedPlan(user.sub, id, dto);
  }
}
