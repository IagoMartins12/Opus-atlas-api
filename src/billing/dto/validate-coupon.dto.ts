import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanType, BillingPeriod } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ValidateCouponDto {
  @ApiProperty({ example: 'BEMVINDO20' })
  @IsString()
  code: string;

  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;
}
