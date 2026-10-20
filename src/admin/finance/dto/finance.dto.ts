import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { FinanceDirection, FinanceKind, FinanceMetric } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const COST_CATEGORIES = [
  'infraestrutura',
  'banco',
  'ia',
  'email',
  'armazenamento',
  'dominio',
  'software',
  'marketing',
  'taxas',
  'impostos',
  'outros',
] as const;

export const INCOME_CATEGORIES = [
  'patrocinio',
  'edital',
  'doacao',
  'premio',
  'outros',
] as const;

export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateFinanceEntryDto {
  @ApiProperty({ enum: FinanceDirection })
  @IsEnum(FinanceDirection)
  direction: FinanceDirection;

  @ApiProperty({ maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Fornecedor (custo) ou quem paga (entrada)',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  counterparty?: string;

  @ApiProperty({
    description: `Custo: ${COST_CATEGORIES.join(', ')}. Entrada: ${INCOME_CATEGORIES.join(', ')}.`,
  })
  @IsString()
  @MaxLength(40)
  category: string;

  @ApiProperty({
    description:
      'Em centavos, inteiro. Único: o valor. Parcelado: o TOTAL. Recorrente: o valor de cada cobrança.',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amountCents: number;

  @ApiPropertyOptional({ enum: CURRENCIES, default: 'BRL' })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @ApiPropertyOptional({
    description:
      'BRL por unidade da moeda. Sem ela, a API usa a PTAX do dia do lançamento; informe para corrigir pela fatura do cartão.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  fxRate?: number;

  @ApiProperty({ enum: FinanceKind })
  @IsEnum(FinanceKind)
  kind: FinanceKind;

  @ApiProperty({
    description: 'Data (único), primeira parcela ou primeira cobrança.',
  })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ description: 'Obrigatório no parcelado (2 a 120).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(120)
  installments?: number;

  @ApiPropertyOptional({
    description: 'Obrigatório no recorrente: a cada N meses (1 a 24).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  intervalMonths?: number;

  @ApiPropertyOptional({
    description: 'Recorrente: a última cobrança, se acaba.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Comprovante, no armazenamento do site.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  receiptUrl?: string;
}

export class UpdateFinanceEntryDto extends PartialType(
  OmitType(CreateFinanceEntryDto, ['direction'] as const),
) {}

export class CreateFinanceGoalDto {
  @ApiProperty({ enum: FinanceMetric })
  @IsEnum(FinanceMetric)
  metric: FinanceMetric;

  @ApiProperty({
    description: 'Centavos no MRR; contagem nos outros.',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  target: number;

  @ApiProperty()
  @IsDateString()
  deadline: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class FinanceMonthQueryDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description: 'AAAA-MM; o mês atual se faltar.',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class FinanceExportQueryDto {
  @ApiProperty({ example: '2026-01' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  from: string;

  @ApiProperty({ example: '2026-12' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  to: string;
}

export class FinanceMrrQueryDto {
  @ApiPropertyOptional({ default: 12, minimum: 2, maximum: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(24)
  months?: number;
}
