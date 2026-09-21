import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Query params aceitos por GET /works.
 * Espelha o contrato hoje implementado em
 * `Classical-Music/src/app/api/works/route.ts` (GET/POST) — ver seção 3.11.2 do SPEC.md.
 */
export class SearchWorksQueryDto {
  @ApiPropertyOptional({
    description:
      'Termo de busca (título, compositor ou catálogo). Mínimo 2 caracteres.',
    example: 'Sonata',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Máximo de resultados retornados (1-50)',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Busca direta por ID da obra. Se fornecido, ignora `q`.',
    example: '665f1c2e4a1b2c3d4e5f6789',
  })
  @IsOptional()
  @IsString()
  id?: string;
}
