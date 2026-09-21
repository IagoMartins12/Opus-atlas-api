import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPeriod, PlanType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiPropertyOptional({
    enum: BillingPeriod,
    description: 'Obrigatório para todo plano que não seja FREE',
  })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @ApiPropertyOptional({ example: 'BEMVINDO20' })
  @IsOptional()
  @IsString()
  couponCode?: string;
}
