import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { NewsletterActionResponseDto } from './dto/newsletter-action-response.dto';
import { ResendNewsletterConfirmationDto } from './dto/resend-confirmation.dto';
import { ResubscribeNewsletterDto } from './dto/resubscribe-newsletter.dto';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { UnsubscribeNewsletterDto } from './dto/unsubscribe-newsletter.dto';
import { NewsletterService } from './newsletter.service';
import { Throttle } from '@nestjs/throttler';

@ApiTags('newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('subscribe')
  @ApiOperation({
    summary: 'Inscreve um e-mail na newsletter (double opt-in)',
    description:
      'Cria a inscrição como `PENDING` e envia um e-mail de confirmação. Se o e-mail já ' +
      'existir como `UNSUBSCRIBED`, reativa a inscrição (mesmo fluxo de `resubscribe`).',
  })
  @ApiOkResponse({ type: NewsletterActionResponseDto })
  async subscribe(
    @Body() dto: SubscribeNewsletterDto,
  ): Promise<NewsletterActionResponseDto> {
    return this.newsletterService.subscribe(dto);
  }

  @Public()
  @Put('subscribe')
  @ApiOperation({
    summary: 'Reenvia o e-mail de confirmação para uma inscrição pendente',
  })
  @ApiOkResponse({ type: NewsletterActionResponseDto })
  async resendConfirmation(
    @Body() dto: ResendNewsletterConfirmationDto,
  ): Promise<NewsletterActionResponseDto> {
    return this.newsletterService.resendConfirmation(dto.email);
  }

  @Public()
  @Get('confirm/:token')
  @ApiOperation({
    summary: 'Confirma a inscrição na newsletter (double opt-in)',
    description:
      'Corrige um bug do legado: o link enviado por e-mail sempre apontava para este ' +
      'formato de rota, mas a implementação original buscava o assinante por um campo ' +
      'nunca preenchido — a confirmação nunca funcionava de fato para visitantes anônimos.',
  })
  @ApiOkResponse({ type: NewsletterActionResponseDto })
  async confirm(
    @Param('token') token: string,
  ): Promise<NewsletterActionResponseDto> {
    return this.newsletterService.confirm(token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('unsubscribe')
  @ApiOperation({
    summary: 'Cancela a inscrição na newsletter',
    description: 'Aceita `token` (do e-mail) ou `email` diretamente.',
  })
  @ApiOkResponse({ type: NewsletterActionResponseDto })
  async unsubscribe(
    @Body() dto: UnsubscribeNewsletterDto,
  ): Promise<NewsletterActionResponseDto> {
    return this.newsletterService.unsubscribe(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resubscribe')
  @ApiOperation({
    summary:
      'Reativa uma inscrição cancelada, enviando novo e-mail de confirmação',
  })
  @ApiOkResponse({ type: NewsletterActionResponseDto })
  async resubscribe(
    @Body() dto: ResubscribeNewsletterDto,
  ): Promise<NewsletterActionResponseDto> {
    return this.newsletterService.resubscribe(dto.email);
  }
}
