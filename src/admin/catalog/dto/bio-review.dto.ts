import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const BIO_REVIEW_STATUSES = ['pending', 'reviewed'] as const;
export type BioReviewStatus = (typeof BIO_REVIEW_STATUSES)[number];

/** A biography is a text, not a line (same bounds as a contribution). */
export const BIO_MIN = 300;
export const BIO_MAX = 12_000;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListBioReviewQueryDto {
  @ApiPropertyOptional({
    enum: BIO_REVIEW_STATUSES,
    default: 'pending',
    description:
      '`pending`: escrita por IA ou traduzida por máquina, ainda sem revisão. `reviewed`: já lida por uma pessoa da equipe.',
  })
  @IsOptional()
  @IsIn(BIO_REVIEW_STATUSES)
  status?: BioReviewStatus;

  @ApiPropertyOptional({ description: 'Nome do compositor' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Continua depois deste compositor' })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ReviewBioDto {
  @ApiPropertyOptional({
    description:
      'Biografia em português reescrita na revisão. Ausente: o texto atual é aprovado como está.',
    minLength: BIO_MIN,
    maxLength: BIO_MAX,
  })
  @IsOptional()
  @IsString()
  @MinLength(BIO_MIN)
  @MaxLength(BIO_MAX)
  bio?: string;

  @ApiPropertyOptional({
    description:
      'Biografia em inglês reescrita na revisão. Ausente: o texto atual é aprovado como está.',
    minLength: BIO_MIN,
    maxLength: BIO_MAX,
  })
  @IsOptional()
  @IsString()
  @MinLength(BIO_MIN)
  @MaxLength(BIO_MAX)
  bioEn?: string;
}
