import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params padrão de paginação, reutilizados em toda listagem
 * offset-based da API (ver seção 3.5 do SPEC.md).
 */
export class PaginationQueryDto {
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
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Itens por página',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
