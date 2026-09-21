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
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Audited } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminNewsletterService } from './admin-newsletter.service';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  ListSubscribersQueryDto,
  RemoveSubscriberQueryDto,
  SendTestCampaignDto,
  UpdateCampaignDto,
  UpdateSubscriberDto,
} from './dto/admin-newsletter.dto';

/**
 * Newsletter: campanhas e assinantes.
 *
 * É a única área do admin que escreve para fora — e-mail sai daqui para pessoas
 * reais —, então o disparo é a operação mais protegida do módulo: exige
 * `SUPER_ADMIN`, é auditada, valida o conteúdo e mede o público antes de
 * enfileirar.
 */
@ApiTags('admin-newsletter')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/newsletter')
export class AdminNewsletterController {
  constructor(private readonly service: AdminNewsletterService) {}

  // --- Campanhas ---

  @Get('campaigns')
  @ApiOperation({ summary: 'Lista campanhas' })
  @ApiOkResponse({ description: 'Campanhas paginadas' })
  async listCampaigns(@Query() query: ListCampaignsQueryDto) {
    return this.service.listCampaigns(query);
  }

  @Get('campaigns/:id')
  @ApiOperation({
    summary: 'Detalhe de uma campanha',
    description:
      '`audienceSize` é uma contagem. O legado carregava todos os assinantes ' +
      'segmentados para usar `subscribers.length`.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Campanha com tamanho do público' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async findCampaign(@Param('id') id: string) {
    return this.service.findCampaign(id);
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'newsletter.campaign.create', entityType: 'campaign' })
  @ApiOperation({
    summary: 'Cria uma campanha',
    description:
      'A segmentação tem forma fechada e validada. No legado ela era JSON livre ' +
      'que ia direto para o `where` do Prisma na hora do envio.',
  })
  @ApiCreatedResponse({ description: 'Campanha criada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async createCampaign(@Body() dto: CreateCampaignDto) {
    return this.service.createCampaign(dto);
  }

  @Patch('campaigns/:id')
  @Audited({
    action: 'newsletter.campaign.update',
    entityType: 'campaign',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Edita uma campanha ainda não disparada' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Campanha atualizada' })
  @ApiConflictResponse({
    description: 'Campanha já disparada',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.updateCampaign(id, dto);
  }

  @Post('campaigns/:id/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audited({
    action: 'newsletter.campaign.send',
    entityType: 'campaign',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Enfileira a campanha para envio',
    description:
      'Responde 202 com o tamanho do público. O legado aguardava o envio dentro ' +
      'da requisição — lotes de 50 com dois segundos de intervalo, ou seja mais ' +
      'de seis minutos para dez mil assinantes — e a conexão estourava enquanto ' +
      'o envio seguia. Agora o envio acontece no worker, e o `job.jobId` da ' +
      'resposta é consultável em `GET /admin/jobs/newsletter/:jobId`. Dois ' +
      'cliques no botão devolvem o **mesmo** id: a chave de idempotência é a ' +
      'campanha, então não há segundo envio.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiAcceptedResponse({ description: 'Campanha enfileirada' })
  @ApiBadRequestResponse({
    description: 'Sem conteúdo, ou nenhum assinante corresponde à segmentação',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Campanha já disparada',
    type: ErrorResponseDto,
  })
  async queueCampaign(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.queueCampaign(id, user.sub);
  }

  @Post('campaigns/:id/test')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'newsletter.campaign.test',
    entityType: 'campaign',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Envia uma prévia para um endereço',
    description: 'Um destinatário só, sem tocar na base de assinantes.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Prévia enviada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async sendTest(@Param('id') id: string, @Body() dto: SendTestCampaignDto) {
    return this.service.sendTest(id, dto);
  }

  @Patch('campaigns/:id/cancel')
  @Audited({
    action: 'newsletter.campaign.cancel',
    entityType: 'campaign',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Cancela uma campanha não disparada' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Campanha cancelada' })
  @ApiConflictResponse({ type: ErrorResponseDto })
  async cancelCampaign(@Param('id') id: string) {
    return this.service.cancelCampaign(id);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'newsletter.campaign.delete',
    entityType: 'campaign',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Remove uma campanha nunca enviada',
    description:
      'Campanha enviada é o registro do que a base recebeu; apagá-la desfaz a ' +
      'única prova de qual conteúdo chegou a quem.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiConflictResponse({ type: ErrorResponseDto })
  async deleteCampaign(@Param('id') id: string): Promise<void> {
    return this.service.deleteCampaign(id);
  }

  // --- Assinantes ---

  @Get('subscribers')
  @ApiOperation({
    summary: 'Lista assinantes',
    description:
      '`sortBy` tem lista fechada — no legado o nome do campo vinha cru da ' +
      'query para o `orderBy`.',
  })
  @ApiOkResponse({ description: 'Assinantes paginados' })
  async listSubscribers(@Query() query: ListSubscribersQueryDto) {
    return this.service.listSubscribers(query);
  }

  @Get('subscribers/export')
  @Audited({
    action: 'newsletter.subscribers.export',
    entityType: 'subscriber',
  })
  @ApiOperation({
    summary: 'Exporta assinantes',
    description: 'Exportar lista de e-mails em massa é ação auditada.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({ description: 'Assinantes exportados' })
  async exportSubscribers(
    @Query() query: ListSubscribersQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.exportSubscribers(query);

    if (!('csv' in result)) {
      return result;
    }

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="assinantes-${new Date().toISOString().slice(0, 10)}.csv"`,
    );

    return `﻿${result.csv}`;
  }

  @Patch('subscribers/:id')
  @Audited({
    action: 'newsletter.subscriber.update',
    entityType: 'subscriber',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita um assinante',
    description:
      'Lista fechada de campos. O legado fazia `data: { ...body }`, o que ' +
      'deixava reescrever `email`, `userId` e o `unsubscribeToken` — este ' +
      'último é o que faz funcionar o link de descadastro já enviado.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Assinante atualizado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateSubscriber(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriberDto,
  ) {
    return this.service.updateSubscriber(id, dto);
  }

  @Delete('subscribers/:id')
  @Audited({
    action: 'newsletter.subscriber.remove',
    entityType: 'subscriber',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Descadastra um assinante',
    description:
      'Por padrão marca como descadastrado. Apagar o registro destrói a prova ' +
      'do opt-out — numa importação seguinte a mesma pessoa volta a receber. A ' +
      'remoção definitiva fica em `?hardDelete=true`, para pedido de exclusão ' +
      'de dados.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ schema: { example: { removed: false } } })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async removeSubscriber(
    @Param('id') id: string,
    @Query() query: RemoveSubscriberQueryDto,
  ) {
    return this.service.removeSubscriber(id, query);
  }

  // --- Números ---

  @Get('stats')
  @ApiOperation({ summary: 'Números de assinantes, campanhas e entrega' })
  @ApiOkResponse({ description: 'Panorama da newsletter' })
  async stats() {
    return this.service.stats();
  }
}
