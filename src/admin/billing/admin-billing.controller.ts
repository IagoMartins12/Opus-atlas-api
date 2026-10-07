import {
  BadRequestException,
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
} from '@nestjs/common';
import { PlanType } from '@prisma/client';
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
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  PLANOS_PAGOS,
  type PlanoPago,
} from '../../billing/services/stripe-catalog.service';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminBillingService } from './admin-billing.service';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  SetPlanPricingDto,
  UpdateCouponDto,
} from './dto/admin-billing.dto';

/**
 * Cupons e preços de plano.
 *
 * É a área onde um valor errado vira cobrança errada, então **toda escrita é
 * auditada** e todo número tem faixa validada. Preço não é sobrescrito: cada
 * alteração cria uma versão e desativa a anterior, preservando o histórico do
 * que foi cobrado.
 */
@ApiTags('admin-billing')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly service: AdminBillingService) {}

  // --- Cupons ---

  @Get('coupons')
  @ApiOperation({
    summary: 'Lista cupons',
    description:
      'Paginada, com as estatísticas vindas de contagens no banco. Cada cupom ' +
      'traz o estado derivado — vigente, expirado, esgotado — para a tela não ' +
      'recalcular.',
  })
  @ApiOkResponse({ description: 'Cupons paginados com estatísticas' })
  async listCoupons(@Query() query: ListCouponsQueryDto) {
    return this.service.listCoupons(query);
  }

  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'coupon.create', entityType: 'coupon' })
  @ApiOperation({
    summary: 'Cria um cupom',
    description:
      'Desconto percentual limitado a 100%, validade final posterior à ' +
      'inicial, e `maxUses: 0` significa zero — no legado virava ilimitado.',
  })
  @ApiCreatedResponse({ description: 'Cupom criado' })
  @ApiBadRequestResponse({
    description: 'Desconto acima de 100% ou validade invertida',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Código já existe',
    type: ErrorResponseDto,
  })
  async createCoupon(@Body() dto: CreateCouponDto) {
    return this.service.createCoupon(dto);
  }

  @Patch('coupons/:id')
  @Audited({
    action: 'coupon.update',
    entityType: 'coupon',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Edita um cupom' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Cupom atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async updateCoupon(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.service.updateCoupon(id, dto);
  }

  @Patch('coupons/:id/toggle')
  @Audited({
    action: 'coupon.toggle',
    entityType: 'coupon',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Ativa ou desativa um cupom' })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Cupom alternado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async toggleCoupon(@Param('id') id: string) {
    return this.service.toggleCoupon(id);
  }

  @Post('coupons/:id/sync')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'coupon.sync',
    entityType: 'coupon',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Cria ou refaz o cupom no Stripe',
    description:
      'O checkout só dá o desconto se o cupom existir no Stripe. Criar e ' +
      'editar já espelham; esta rota é para o cupom antigo ou para quando o ' +
      'Stripe recusou. O motivo de uma falha volta em `stripeSyncError`.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiOkResponse({ description: 'Cupom com o estado do espelho' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async syncCoupon(@Param('id') id: string) {
    return this.service.syncCoupon(id);
  }

  @Delete('coupons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    action: 'coupon.delete',
    entityType: 'coupon',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Remove um cupom nunca usado',
    description:
      'Além de `usedCount`, contam os usos registrados e as assinaturas que ' +
      'apontam para o cupom: o contador pode estar defasado, e apagar um cupom ' +
      'referenciado quebraria o histórico de cobrança.',
  })
  @ApiParam({ name: 'id', example: '685d591c1e3db0c5aaa893e4' })
  @ApiNoContentResponse({ description: 'Cupom removido' })
  @ApiConflictResponse({
    description: 'Cupom já usado — desative em vez de remover',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async deleteCoupon(@Param('id') id: string): Promise<void> {
    return this.service.deleteCoupon(id);
  }

  // --- Preços ---

  @Get('plan-pricing')
  @ApiOperation({ summary: 'Preços vigentes' })
  @ApiOkResponse({ description: 'Um preço ativo por plano' })
  async listPricing() {
    return this.service.listPricing();
  }

  @Get('plan-pricing/stripe')
  @ApiOperation({
    summary: 'Painel e Stripe lado a lado',
    description:
      'Para cada plano pago: o preço do painel, o Price que vale no Stripe ' +
      '(mensal e anual) e se os dois batem — em valor e no id que o checkout ' +
      'usa.',
  })
  @ApiOkResponse({ description: 'Estado da sincronização por plano' })
  async pricingStripeStatus() {
    return this.service.pricingStripeStatus();
  }

  @Post('plan-pricing/:planType/push')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'plan-pricing.push', entityType: 'planPricing' })
  @ApiOperation({
    summary: 'Envia o preço do painel ao Stripe',
    description:
      'Cria o Price que falta, faz dele o padrão do produto e arquiva o ' +
      'anterior. Quem já assina continua no preço antigo.',
  })
  @ApiParam({ name: 'planType', enum: PLANOS_PAGOS })
  @ApiOkResponse({ description: 'Versão vigente, com os ids do Stripe' })
  async pushPricing(@Param('planType') planType: string) {
    return this.service.pushPricing(this.planoPago(planType));
  }

  @Post('plan-pricing/:planType/pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Traz para o painel o preço que vale no Stripe',
    description:
      'Cria uma versão nova com os valores do Stripe (origem `stripe`). É o ' +
      'mesmo que o webhook faz sozinho quando o preço muda lá. Auditada pelo ' +
      'serviço, que sabe o antes e o depois.',
  })
  @ApiParam({ name: 'planType', enum: PLANOS_PAGOS })
  @ApiOkResponse({ description: 'Se adotou, e por quê' })
  async pullPricing(
    @Param('planType') planType: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.service.pullPricing(this.planoPago(planType), user.sub);
  }

  @Get('plan-pricing/:planType/history')
  @ApiOperation({
    summary: 'Histórico de preços de um plano',
    description: 'Permite conferir o que estava valendo na data de uma fatura.',
  })
  @ApiParam({ name: 'planType', enum: PlanType })
  @ApiOkResponse({ description: 'Versões de preço, da mais recente' })
  async pricingHistory(@Param('planType') planType: PlanType) {
    return this.service.pricingHistory(planType);
  }

  @Post('plan-pricing')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'plan-pricing.set', entityType: 'planPricing' })
  @ApiOperation({
    summary: 'Define o preço vigente de um plano',
    description:
      'Todo número tem faixa validada e os preços derivados são arredondados a ' +
      'centavos. No legado, `if (monthlyPrice < 0)` era a única verificação — e ' +
      'como `undefined < 0` é falso, um corpo sem preço gravava `NaN` nas ' +
      'quatro colunas; descontos acima de 100% produziam preço negativo.',
  })
  @ApiCreatedResponse({ description: 'Nova versão de preço criada' })
  @ApiBadRequestResponse({
    description: 'Valor fora da faixa aceita',
    type: ErrorResponseDto,
  })
  async setPricing(@Body() dto: SetPlanPricingDto) {
    return this.service.setPricing(dto);
  }

  private planoPago(planType: string): PlanoPago {
    const plano = planType.toUpperCase();

    if (!(PLANOS_PAGOS as readonly string[]).includes(plano)) {
      throw new BadRequestException(
        `Só planos pagos têm preço no Stripe: ${PLANOS_PAGOS.join(', ')}.`,
      );
    }

    return plano as PlanoPago;
  }
}
