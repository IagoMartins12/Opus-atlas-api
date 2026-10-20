import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * - `featured`: with a portrait and the most complete record first.
 * - `oldest` / `newest`: by the record, that is, when the composer entered the
 *   library (`createdAt`) — not by birth year, which is a filter
 *   (`bornFrom`/`bornTo`) and not a sort.
 */
export const COMPOSER_SORTS = [
  'featured',
  'name',
  'name-desc',
  'oldest',
  'newest',
] as const;
export type ComposerSort = (typeof COMPOSER_SORTS)[number];

/** Filters shared by `GET /composers` and `GET /composers/count`. */
export class ComposerCountQueryDto {
  @ApiPropertyOptional({
    description:
      'Busca por nome, nome completo ou nomes alternativos (apelidos, transliterações)',
    example: 'bach',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtra por época',
    example: '685d591c1e3db0c5aaa893e4',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  epochId?: string;

  @ApiPropertyOptional({
    description:
      'Nacionalidades como gravadas (gentílico), separadas por vírgula: `German,Alemão`',
    example: 'Polish',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({
    description: 'Só quem compôs para este instrumento',
    example: '685d591c1e3db0c5aaa893e4',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsMongoId()
  instrumentId?: string;

  @ApiPropertyOptional({ description: 'Só com retrato válido' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withPortrait?: boolean;

  @ApiPropertyOptional({
    description: 'Só compositores conferidos pela equipe (selo de verificado)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    description: 'Nasceu a partir deste ano',
    example: 1600,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(400)
  @Max(2100)
  bornFrom?: number;

  @ApiPropertyOptional({ description: 'Nasceu até este ano', example: 1900 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(400)
  @Max(2100)
  bornTo?: number;

  @ApiPropertyOptional({
    enum: COMPOSER_SORTS,
    default: 'name',
  })
  @IsOptional()
  @IsIn(COMPOSER_SORTS)
  sort?: ComposerSort;
}
