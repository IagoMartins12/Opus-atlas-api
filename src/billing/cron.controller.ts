import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { appEnvOf } from '../config/env-files';
import {
  CronCheckResult,
  SubscriptionsCronService,
} from './services/subscriptions-cron.service';

/**
 * Job de manutenção diária de assinaturas — chamado por um scheduler externo
 * (cron gerenciado fora da aplicação), protegido pela mesma `x-api-key`
 * usada por outras rotas server-to-server.
 */
@ApiTags('billing-cron')
@ApiSecurity('api-key')
@Public()
@UseGuards(ApiKeyGuard)
@Controller('cron')
export class CronController {
  constructor(private readonly cronService: SubscriptionsCronService) {}

  @Post('check-subscriptions')
  @ApiOperation({
    summary: 'Verifica trials/renovações expirando e assinaturas vencidas',
    description:
      'Envia notificações (trial expirando, lembrete de renovação) e expira trials/' +
      'assinaturas vencidas. Recomendado rodar 1x por dia.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        timestamp: '2026-09-07T03:00:00.000Z',
        results: {
          trialsExpiring: 2,
          trialsExpired: 1,
          renewalsReminder: 3,
          subscriptionsExpired: 0,
          checkoutsAbandoned: 1,
          errors: [],
        },
      },
    },
  })
  @ApiQuery({
    name: 'at',
    required: false,
    description:
      'Só fora da produção: roda como se fosse esta data (ISO), para acompanhar o relógio de teste do Stripe.',
  })
  async checkSubscriptions(@Query('at') at?: string): Promise<{
    success: true;
    timestamp: string;
    results: CronCheckResult;
  }> {
    let now = new Date();
    if (at) {
      if (appEnvOf() === 'prd') {
        throw new BadRequestException('Data forçada não vale em produção');
      }
      now = new Date(at);
      if (Number.isNaN(now.getTime())) {
        throw new BadRequestException('Data inválida em "at"');
      }
    }
    const results = await this.cronService.checkSubscriptions(now);
    return { success: true, timestamp: now.toISOString(), results };
  }
}
