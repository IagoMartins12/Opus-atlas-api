import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CouponType, PlanType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Código do cupom.
 *
 * Guardado sempre em maiúsculas, como no legado, mas com formato validado:
 * espaço ou acento num código de cupom vira problema de digitação no checkout.
 */
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

const upperCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateCouponDto {
  @ApiProperty({ example: 'BEMVINDO20' })
  @Transform(upperCase)
  @Matches(COUPON_CODE, {
    message:
      'O código deve ter de 3 a 32 caracteres, apenas letras, números, hífen e sublinhado.',
  })
  code: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType)
  type: CouponType;

  /**
   * Valor do desconto.
   *
   * O teto de 100 vale para `PERCENTAGE` e é conferido no serviço, que conhece
   * o tipo. Aqui fica a garantia mínima: número finito e não negativo. No
   * legado era `parseFloat(discountValue)` sem verificação alguma — um cupom de
   * 500% ou de valor negativo entrava.
   */
  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({
    description: 'Teto do desconto, em reais. Só faz sentido em percentual.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number;

  @ApiPropertyOptional({
    enum: PlanType,
    isArray: true,
    description: 'Vazio significa todos os planos.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(PlanType, { each: true })
  @ArrayMaxSize(10)
  applicablePlans?: PlanType[];

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  validUntil: string;

  /**
   * Total de usos permitido.
   *
   * `null` é ilimitado. No legado, `maxUses: 0` caía em
   * `maxUses ? parseInt(maxUses) : null` e virava **ilimitado** — o oposto do
   * que quem digitou zero queria.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'Nulo é ilimitado. Zero é zero.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUses?: number | null;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUsesPerUser?: number;

  @ApiPropertyOptional({ description: 'Dias extras de teste.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  extraTrialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponDto {
  @ApiPropertyOptional({ enum: CouponType })
  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDiscount?: number;

  @ApiPropertyOptional({ enum: PlanType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(PlanType, { each: true })
  @ArrayMaxSize(10)
  applicablePlans?: PlanType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUses?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUsesPerUser?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  extraTrialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCouponsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(queryBoolean)
  isActive?: boolean;

  @ApiPropertyOptional({ enum: CouponType })
  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;
}

/**
 * Preço de um plano.
 *
 * Cada campo numérico é validado como número finito dentro de faixa. No legado
 * a única verificação era `if (monthlyPrice < 0)` — e `undefined < 0` é
 * `false`, então um corpo sem preço passava e as quatro colunas de preço eram
 * gravadas como `NaN`. Os descontos não eram verificados de forma alguma: 150%
 * produzia preço negativo.
 */
export class SetPlanPricingDto {
  @ApiProperty({ enum: PlanType })
  @IsEnum(PlanType)
  planType: PlanType;

  @ApiProperty({ example: 29.9, description: 'Preço mensal, em reais.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  monthlyPrice: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Desconto trimestral, em %.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  quarterlyDiscount?: number;

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  biannualDiscount?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  yearlyDiscount?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
