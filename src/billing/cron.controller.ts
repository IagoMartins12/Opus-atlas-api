import { Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
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
  async checkSubscriptions(): Promise<{
    success: true;
    timestamp: string;
    results: CronCheckResult;
  }> {
    const results = await this.cronService.checkSubscriptions();
    return { success: true, timestamp: new Date().toISOString(), results };
  }
}
