import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PeriodPricingDto {
  @ApiProperty({ example: 191.04 })
  price: number;

  @ApiProperty({ example: 20 })
  discount: number;

  @ApiProperty({ example: 15.92 })
  monthlyEquivalent: number;

  @ApiProperty({ example: 47.76 })
  savings: number;
}

export class PlanPricingDto {
  @ApiProperty({ example: 19.9 })
  monthly: number;

  @ApiProperty({ type: PeriodPricingDto })
  quarterly: PeriodPricingDto;

  @ApiProperty({ type: PeriodPricingDto })
  biannual: PeriodPricingDto;

  @ApiProperty({ type: PeriodPricingDto })
  yearly: PeriodPricingDto;

  @ApiProperty({ example: 7 })
  trialDays: number;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;
}

export class PricingResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description:
      'Preços por tipo de plano (chaves: PLUS, MENTOR, MAESTRO — FREE não aparece)',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/PlanPricingDto' },
  })
  data: Record<string, PlanPricingDto>;
}
