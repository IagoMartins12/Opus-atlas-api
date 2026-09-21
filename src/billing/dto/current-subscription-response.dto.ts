import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType } from '@prisma/client';

class CurrentPlanDto {
  @ApiProperty({ enum: PlanType })
  type: PlanType;

  @ApiProperty({ example: true })
  isValid: boolean;

  @ApiProperty({ example: false })
  isTrialActive: boolean;

  @ApiProperty({ example: 0 })
  trialDaysRemaining: number;

  @ApiPropertyOptional({ nullable: true })
  expiresAt?: Date | null;

  @ApiProperty({
    type: Object,
    description: 'Matriz de features habilitadas/limites do plano atual',
  })
  features: unknown;
}

export class CurrentSubscriptionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: CurrentPlanDto })
  plan: CurrentPlanDto;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description:
      'Registro completo de `Subscription`, ou `null` se o usuário está no FREE sem registro',
  })
  subscription?: unknown;

  @ApiProperty({ type: [Object] })
  history: unknown[];

  @ApiProperty({ type: [Object] })
  recentPayments: unknown[];
}
