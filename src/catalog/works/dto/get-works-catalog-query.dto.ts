import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * - `featured`: the works of the curated famous composers first (the most
 *   studied ahead), then the rest from A to Z.
 * - `oldest` / `newest`: by the record, when the work entered the library.
 */
export const WORK_CATALOG_SORTS = [
  'featured',
  'title',
  'title-desc',
  'oldest',
  'newest',
] as const;
export type WorkCatalogSort = (typeof WORK_CATALOG_SORTS)[number];

export class GetWorksCatalogQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    description: 'Página atual (1-indexed)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 32,
    minimum: 1,
    maximum: 100,
    description: 'Quantidade de obras por página',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 32;

  @ApiPropertyOptional({
    description: 'Filtra por compositor',
    example: '665f1c2e4a1b2c3d4e5f6789',
  })
  @IsOptional()
  @IsString()
  composerId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por instrumento',
    example: '665f1c2e4a1b2c3d4e5f6790',
  })
  @IsOptional()
  @IsString()
  instrumentId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por época',
    example: '665f1c2e4a1b2c3d4e5f6791',
  })
  @IsOptional()
  @IsString()
  epochId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por gênero via ID da coleção WorkGenre',
    example: '665f1c2e4a1b2c3d4e5f6792',
  })
  @IsOptional()
  @IsString()
  workGenreId?: string;

  @ApiPropertyOptional({
    description: 'Busca textual por título, subtítulo, catálogo e compositor',
    example: 'Sonata',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtra por categoria textual existente em `categoryNames`',
    example: 'Concerto',
  })
  @IsOptional()
  @IsString()
  categoryNames?: string;

  @ApiPropertyOptional({
    description:
      'Filtra por nome textual do gênero existente em `workGenresArr`',
    example: 'Romantic',
  })
  @IsOptional()
  @IsString()
  workGenresArr?: string;

  @ApiPropertyOptional({
    description: 'Filtra por nível de dificuldade',
    example: 'INTERMEDIATE',
  })
  @IsOptional()
  @IsString()
  difficultyLevel?: string;

  @ApiPropertyOptional({
    description: 'Só obras conferidas pela equipe (selo de verificado)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    enum: WORK_CATALOG_SORTS,
    description:
      'Ordem. Sem ela: as mais recentes sem filtro, A–Z com filtro (como antes).',
  })
  @IsOptional()
  @IsIn(WORK_CATALOG_SORTS)
  sort?: WorkCatalogSort;
}
