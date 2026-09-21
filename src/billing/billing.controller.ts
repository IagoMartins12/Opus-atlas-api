import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Body } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { CouponValidationResponseDto } from './dto/coupon-validation-response.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CurrentSubscriptionResponseDto } from './dto/current-subscription-response.dto';
import { InvoiceDetailResponseDto } from './dto/invoice-detail-response.dto';
import { PaymentHistoryResponseDto } from './dto/payment-history-response.dto';
import { PlanPricingDto, PricingResponseDto } from './dto/pricing-response.dto';
import { SubscriptionActionResponseDto } from './dto/subscription-action-response.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponsService } from './services/coupons.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { PlanPricingService } from './services/plan-pricing.service';
import { StripeService } from './services/stripe.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { Throttle } from '@nestjs/throttler';

// `PricingResponseDto.data` aponta para `PlanPricingDto` por `$ref` (um mapa
// por tipo de plano); sem registrá-lo aqui, o schema não entra no documento
// e a referência fica quebrada para quem gera cliente a partir dele.
@ApiExtraModels(PlanPricingDto)
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly planPricingService: PlanPricingService,
    private readonly couponsService: CouponsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsService: PaymentsService,
    private readonly invoicesService: InvoicesService,
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('pricing')
  @ApiOperation({ summary: 'Preços públicos dos planos pagos' })
  @ApiOkResponse({ type: PricingResponseDto })
  async getPricing(): Promise<PricingResponseDto> {
    return this.planPricingService.getPricing();
  }

  @ApiBearerAuth('access-token')
  // Sem limite dedicado, dá para varrer o espaço de códigos de cupom.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('coupon/validate')
  @ApiOperation({
    summary: 'Valida um cupom de desconto para um plano/período',
  })
  @ApiOkResponse({ type: CouponValidationResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async validateCoupon(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ValidateCouponDto,
  ): Promise<CouponValidationResponseDto> {
    return this.couponsService.validate(user.sub, dto);
  }

  @ApiBearerAuth('access-token')
  @Post('subscription/create')
  @ApiOperation({
    summary:
      'Cria uma nova assinatura (FREE imediato, ou checkout Stripe para planos pagos)',
    description:
      'Consolida os antigos `subscription/create` e `stripe/checkout` do legado — duas ' +
      'implementações que faziam essencialmente a mesma coisa (uma criando Product/Price ' +
      'novos no Stripe a cada chamada, a outra usando Price IDs fixos). Aqui só existe um ' +
      'caminho, usando Price IDs pré-cadastrados.',
  })
  @ApiOkResponse({ type: SubscriptionActionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async createSubscription(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: { email: true, firstName: true, lastName: true },
    });

    if (!dbUser.email) {
      throw new BadRequestException('Conta sem e-mail cadastrado');
    }

    const userName =
      `${dbUser.firstName ?? ''} ${dbUser.lastName ?? ''}`.trim() || 'Usuário';

    return this.subscriptionsService.create(
      user.sub,
      dbUser.email,
      userName,
      dto,
    );
  }

  @Public()
  @Get('stripe/success')
  @ApiOperation({
    summary: 'Confirma o pagamento após o retorno do Checkout do Stripe',
    description:
      'Idempotente — se o webhook já confirmou a mesma sessão primeiro, não duplica o pagamento.',
  })
  @ApiOkResponse({ schema: { example: { success: true } } })
  async confirmStripeSuccess(
    @Query('session_id') sessionId?: string,
  ): Promise<{ success: true }> {
    if (!sessionId) {
      throw new BadRequestException('session_id ausente');
    }

    await this.subscriptionsService.confirmCheckoutSession(sessionId);
    return { success: true };
  }

  @ApiBearerAuth('access-token')
  @Post('stripe/portal')
  @ApiOperation({
    summary: 'Abre o Portal do Cliente do Stripe para o usuário logado',
  })
  @ApiOkResponse({
    schema: {
      example: { success: true, url: 'https://billing.stripe.com/...' },
    },
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async openBillingPortal(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<{ success: true; url: string }> {
    const subscription = await this.subscriptionsService.getCurrentSubscription(
      user.sub,
    );

    if (!subscription?.stripeCustomerId) {
      throw new NotFoundException(
        'Nenhuma assinatura com Stripe ativa encontrada',
      );
    }

    const frontendBaseUrl = this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
    const portalSession = await this.stripeService.createBillingPortalSession(
      subscription.stripeCustomerId,
      frontendBaseUrl,
    );

    return { success: true, url: portalSession.url };
  }

  @ApiBearerAuth('access-token')
  @Get('subscription/current')
  @ApiOperation({
    summary:
      'Assinatura atual do usuário logado, com histórico e pagamentos recentes',
  })
  @ApiOkResponse({ type: CurrentSubscriptionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async getCurrentSubscription(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<CurrentSubscriptionResponseDto> {
    return this.subscriptionsService.getCurrent(user.sub);
  }

  @ApiBearerAuth('access-token')
  @Post('subscription/cancel')
  @ApiOperation({
    summary: 'Cancela a assinatura (acesso continua até o fim do período pago)',
  })
  @ApiOkResponse({ type: SubscriptionActionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async cancelSubscription(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CancelSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    return this.subscriptionsService.cancel(user.sub, dto);
  }

  @ApiBearerAuth('access-token')
  @Post('subscription/reactivate')
  @ApiOperation({
    summary: 'Reativa uma assinatura cancelada, antes do fim do período',
  })
  @ApiOkResponse({ type: SubscriptionActionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async reactivateSubscription(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<SubscriptionActionResponseDto> {
    return this.subscriptionsService.reactivate(user.sub);
  }

  @ApiBearerAuth('access-token')
  @Post('subscription/upgrade')
  @ApiOperation({
    summary: 'Faz upgrade (checkout imediato) ou downgrade (agendado) de plano',
    description:
      'Downgrade só agenda a troca para o fim do ciclo atual. Upgrade cria um novo checkout ' +
      'Stripe — a assinatura anterior só é cancelada depois que o pagamento é confirmado ' +
      '(o legado cancelava no mesmo instante do checkout, arriscando deixar o usuário sem ' +
      'nenhum plano pago caso o pagamento fosse abandonado).',
  })
  @ApiOkResponse({ type: SubscriptionActionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async upgradeSubscription(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpgradeSubscriptionDto,
  ): Promise<SubscriptionActionResponseDto> {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: { email: true },
    });

    if (!dbUser.email) {
      throw new BadRequestException('Conta sem e-mail cadastrado');
    }

    return this.subscriptionsService.upgrade(user.sub, dbUser.email, dto);
  }

  @ApiBearerAuth('access-token')
  @Get('payment/history')
  @ApiOperation({ summary: 'Histórico de pagamentos do usuário logado' })
  @ApiOkResponse({ type: PaymentHistoryResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async getPaymentHistory(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<PaymentHistoryResponseDto> {
    return this.paymentsService.getHistory(user.sub);
  }

  @ApiBearerAuth('access-token')
  @Get('invoice/:invoiceId')
  @ApiOperation({
    summary: 'Dados de uma nota fiscal (JSON) — só o dono ou um admin',
  })
  @ApiOkResponse({ type: InvoiceDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async getInvoice(
    @CurrentUser() user: AccessTokenPayload,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceDetailResponseDto> {
    return this.invoicesService.getDetail(user.sub, user.role >= 1, invoiceId);
  }

  @ApiBearerAuth('access-token')
  @Get('invoice/:invoiceId/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'Renderiza a nota fiscal como HTML para visualização/impressão',
    description:
      'Rota nova (o legado só tinha `GET`, que já retornava HTML direto em vez de JSON); ' +
      'separada aqui para deixar `GET /invoice/:id` consistente com o resto da API (sempre JSON).',
  })
  async getInvoiceHtml(
    @CurrentUser() user: AccessTokenPayload,
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.invoicesService.getHtml(
      user.sub,
      user.role >= 1,
      invoiceId,
    );
    res.send(html);
  }
}
