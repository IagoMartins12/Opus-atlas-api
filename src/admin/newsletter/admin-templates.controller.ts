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
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminTemplatesService } from './admin-templates.service';
import {
  BulkDeleteTemplatesDto,
  CreateTemplateDto,
  CreateTestListDto,
  ListTemplatesQueryDto,
  NewsletterAnalyticsQueryDto,
  UpdateTemplateDto,
  UpdateTestListDto,
} from './dto/admin-templates.dto';

/**
 * Templates, listas de teste e números da newsletter.
 */
@ApiTags('admin-newsletter')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/newsletter')
export class AdminTemplatesController {
  constructor(private readonly service: AdminTemplatesService) {}

  // --- Templates ---

  @Get('templates')
  @ApiOperation({
    summary: 'Lista templates',
    description:
      'A listagem não devolve o HTML: um template pode ter duzentos mil ' +
      'caracteres, e vinte deles seriam megabytes que a tela de lista não usa.',
  })
  @ApiOkResponse({ description: 'Templates paginados, com uso em campanhas' })
  async listTemplates(@Query() query: ListTemplatesQueryDto) {
    return this.service.listTemplates(query);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Detalhe do template, com conteúdo' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Template completo' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findTemplate(@Param('id') id: string) {
    return this.service.findTemplate(id);
  }

  @Get('templates/:id/analysis')
  @ApiOperation({
    summary: 'Diagnóstico do template',
    description:
      'Cada apontamento traz o valor medido, não só um veredito. Falta de link ' +
      'de descadastro e ausência de versão em texto são bloqueantes; o resto é ' +
      'aviso.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Apontamentos, métricas e desempenho' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async analyze(@Param('id') id: string) {
    return this.service.analyzeTemplate(id);
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'newsletter.template.create', entityType: 'template' })
  @ApiOperation({ summary: 'Cria um template' })
  @ApiCreatedResponse({ description: 'Template criado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async createTemplate(@Body() dto: CreateTemplateDto) {
    return this.service.createTemplate(dto);
  }

  @Patch('templates/:id')
  @Audited({
    action: 'newsletter.template.update',
    entityType: 'template',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Edita um template' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Template atualizado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.service.updateTemplate(id, dto);
  }

  @Post('templates/bulk-delete')
  @Audited({ action: 'newsletter.template.bulkDelete', entityType: 'template' })
  @ApiOperation({
    summary: 'Remove templates em lote',
    description:
      'É `POST` porque o legado mandava os ids no corpo de um `DELETE`, e ' +
      'intermediários costumam descartar corpo em `DELETE`. Ids repetidos não ' +
      'contam duas vezes, e a verificação de uso roda na mesma transação da ' +
      'remoção.',
  })
  @ApiOkResponse({ schema: { example: { deleted: 3 } } })
  @ApiConflictResponse({
    description: 'Algum template está em uso por campanhas',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async bulkDelete(@Body() dto: BulkDeleteTemplatesDto) {
    return this.service.bulkDeleteTemplates(dto);
  }

  // --- Listas de teste ---

  @Get('test-lists')
  @ApiOperation({ summary: 'Lista as listas de teste' })
  @ApiOkResponse({ description: 'Listas de teste' })
  async listTestLists() {
    return this.service.listTestLists();
  }

  @Post('test-lists')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'newsletter.testList.create', entityType: 'testList' })
  @ApiOperation({
    summary: 'Cria uma lista de teste',
    description:
      'Os endereços são normalizados e o contador é gravado na mesma escrita — ' +
      'deixá-lo para depois é como ele passa a divergir da lista.',
  })
  @ApiCreatedResponse({ description: 'Lista criada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async createTestList(@Body() dto: CreateTestListDto) {
    return this.service.createTestList(dto);
  }

  @Patch('test-lists/:id')
  @Audited({
    action: 'newsletter.testList.update',
    entityType: 'testList',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Edita uma lista de teste' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Lista atualizada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateTestList(
    @Param('id') id: string,
    @Body() dto: UpdateTestListDto,
  ) {
    return this.service.updateTestList(id, dto);
  }

  @Delete('test-lists/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'newsletter.testList.delete',
    entityType: 'testList',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Remove uma lista de teste' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Lista removida' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async deleteTestList(@Param('id') id: string): Promise<void> {
    return this.service.deleteTestList(id);
  }

  // --- Analytics ---

  @Get('analytics')
  @ApiOperation({
    summary: 'Números da newsletter no período',
    description:
      'As consultas são paralelas. O legado encadeava seis auxiliares com ' +
      '`await` em sequência, somando as latências.',
  })
  @ApiOkResponse({ description: 'Assinantes, campanhas e entrega' })
  async analytics(@Query() query: NewsletterAnalyticsQueryDto) {
    return this.service.analytics(query);
  }

  @Get('analytics/export')
  @Audited({ action: 'newsletter.analytics.export', entityType: 'campaign' })
  @ApiOperation({ summary: 'Exporta os números do período' })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Números exportados' })
  async exportAnalytics(
    @Query() query: NewsletterAnalyticsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.exportAnalytics(query);

    if (!('csv' in result)) {
      return result;
    }

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="newsletter-${new Date().toISOString().slice(0, 10)}.csv"`,
    );

    return `﻿${result.csv}`;
  }
}
