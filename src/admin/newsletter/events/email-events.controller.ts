import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/api-key.decorator';
import { EmailEventsService } from './email-events.service';
import { toDeliveryEvent, verifySvixSignature } from './resend.adapter';

const PROVIDER = 'resend';

/**
 * Recebe os eventos de entrega do provedor de e-mail.
 *
 * **É o canal que faltava para `emailsDelivered` significar alguma coisa.** Até
 * aqui o disparo contava `emailsSent` — o que o servidor de saída aceitou — e
 * ninguém escrevia entrega, retorno, abertura ou denúncia de spam. O legado
 * copiava `emailsSent` para `emailsDelivered` no fim do envio "assumindo
 * entrega imediata", o que dava **100% de entrega em toda campanha**, inclusive
 * nas que caíram inteiras no spam.
 *
 * A rota é pública porque é o provedor que a chama, e **a autenticação é a
 * assinatura**. Sem ela, um POST anônimo forjando `email.bounced` desinscreve
 * assinante por assinante até esvaziar a lista.
 *
 * **A resposta é 200 mesmo para evento desconhecido.** Devolver erro para um
 * tipo que ainda não tratamos faz o provedor reentregar em laço e, depois de
 * algumas tentativas, **desativar o webhook inteiro** — perdendo também os
 * eventos que interessam.
 */
@ApiTags('newsletter-webhook')
@Controller('webhook')
export class EmailEventsController {
  private readonly logger = new Logger(EmailEventsController.name);

  constructor(
    private readonly events: EmailEventsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('email')
  @ApiExcludeEndpoint()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ): Promise<{ received: true }> {
    const secret = this.config.get<string>('mail.webhookSecret');

    if (!secret) {
      // Sem segredo configurado não há como distinguir o provedor de um
      // estranho. Aceitar seria pior do que recusar.
      throw new BadRequestException('Webhook de e-mail não configurado');
    }

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException('Assinatura do webhook ausente');
    }

    if (!req.rawBody) {
      throw new BadRequestException(
        'Corpo cru da requisição indisponível — verifique a configuração de `rawBody` do Nest',
      );
    }

    const valid = verifySvixSignature({
      secret,
      id: svixId,
      timestamp: svixTimestamp,
      signatureHeader: svixSignature,
      rawBody: req.rawBody,
    });

    if (!valid) {
      this.logger.warn(`Assinatura inválida no webhook de e-mail (${svixId})`);
      throw new BadRequestException('Assinatura inválida');
    }

    const event = toDeliveryEvent(req.body, svixId);

    if (!event) {
      this.logger.debug(
        `Evento de e-mail ignorado: tipo não tratado (${svixId})`,
      );

      return { received: true };
    }

    await this.events.ingest(PROVIDER, [event]);

    return { received: true };
  }
}
