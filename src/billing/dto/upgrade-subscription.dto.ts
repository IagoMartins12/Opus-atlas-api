import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPeriod, PlanType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class UpgradeSubscriptionDto {
  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  newPlanType: PlanType;

  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;
}
