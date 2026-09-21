import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/api-key.decorator';
import { StripeService } from './services/stripe.service';
import { WebhookService } from './services/webhook.service';

/**
 * Único endpoint de webhook do Stripe — substitui as três implementações
 * duplicadas do legado (`webhook`, `payment/webhook`, `webhook/stripe`). Ver
 * Fase 2G do ROADMAP para o histórico completo da consolidação, incluindo o
 * achado de uma chave secreta do Stripe hardcoded em duas dessas rotas.
 */
@ApiTags('billing-webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly webhookService: WebhookService,
  ) {}

  @Public()
  @Post('stripe')
  @ApiExcludeEndpoint()
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Assinatura do webhook ausente');
    }

    if (!req.rawBody) {
      throw new BadRequestException(
        'Corpo cru da requisição indisponível — verifique a configuração de `rawBody` do Nest',
      );
    }

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(req.rawBody, signature);
    } catch (error) {
      this.logger.warn(
        `Assinatura de webhook inválida: ${(error as Error).message}`,
      );
      throw new BadRequestException('Assinatura inválida');
    }

    await this.webhookService.handleEvent(event);

    return { received: true };
  }
}
