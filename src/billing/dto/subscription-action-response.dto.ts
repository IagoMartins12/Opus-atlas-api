import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CheckoutInfoDto {
  @ApiProperty({ example: 'cs_test_a1b2c3' })
  sessionId: string;

  @ApiProperty({ example: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3' })
  checkoutUrl: string;
}

/** Resposta genérica para ações de assinatura (criar/cancelar/reativar/upgrade). */
export class SubscriptionActionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Assinatura criada com sucesso' })
  message: string;

  @ApiPropertyOptional({
    description:
      'Registro da assinatura (`Subscription`), passado adiante como veio do Prisma',
    type: Object,
  })
  subscription?: unknown;

  @ApiPropertyOptional({ type: CheckoutInfoDto })
  payment?: CheckoutInfoDto;

  @ApiPropertyOptional({ example: '2026-09-20T00:00:00.000Z', nullable: true })
  accessUntil?: Date | null;
}
