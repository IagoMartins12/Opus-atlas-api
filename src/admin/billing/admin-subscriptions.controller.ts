import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  ListSubscriptionsQueryDto,
  SubscriptionsOverviewQueryDto,
} from './dto/admin-subscriptions.dto';

/**
 * Assinaturas: panorama de receita e de quem assina, lista e detalhe.
 *
 * Só leitura. Cancelar, reembolsar e trocar de plano continuam no Stripe (e
 * no portal da própria pessoa): a verdade de cobrança mora lá, e uma escrita
 * aqui que não passasse por ele deixaria banco e cartão discordando.
 */
@ApiTags('admin-billing')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly service: AdminSubscriptionsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Receita e assinantes',
    description:
      'Receita total e no período (com o período anterior para comparar), ' +
      'receita por mês nos últimos 12, recorrente mensal, assinantes vivos ' +
      'por plano e período, novos, cancelamentos, taxa de cancelamento e ' +
      'quem deixou vencer sem voltar.',
  })
  @ApiOkResponse({ description: 'Panorama de cobrança' })
  async overview(@Query() query: SubscriptionsOverviewQueryDto) {
    return this.service.overview(query.days);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista de assinaturas',
    description:
      'Por estado (ativas, teste, atraso, vão sair, não renovaram, expiradas, ' +
      'pendentes), plano, período e busca por nome ou e-mail. Paginada por cursor.',
  })
  @ApiOkResponse({ description: 'Assinaturas com total pago' })
  async list(@Query() query: ListSubscriptionsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe de uma assinatura, com pagamentos e histórico',
  })
  @ApiOkResponse({ description: 'Assinatura' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}
