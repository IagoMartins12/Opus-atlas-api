import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CouponSummaryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'BEMVINDO20' })
  code: string;

  @ApiProperty({ example: 'PERCENTAGE' })
  type: string;

  @ApiProperty({ example: 20 })
  discountValue: number;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  extraTrialDays?: number | null;
}

class CouponPricingDto {
  @ApiProperty({ example: 191.04 })
  originalPrice: number;

  @ApiProperty({ example: 38.21 })
  discount: number;

  @ApiProperty({ example: 152.83 })
  finalPrice: number;

  @ApiProperty({ example: 38.21 })
  savings: number;

  @ApiProperty({ example: '20.00' })
  savingsPercentage: string;
}

export class CouponValidationResponseDto {
  @ApiProperty({ example: true })
  valid: boolean;

  @ApiPropertyOptional()
  error?: string;

  @ApiPropertyOptional({ type: CouponSummaryDto })
  coupon?: CouponSummaryDto;

  @ApiPropertyOptional({ type: CouponPricingDto })
  pricing?: CouponPricingDto;

  @ApiPropertyOptional()
  message?: string;
}
