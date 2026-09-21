import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetWorkScoresQueryDto {
  @ApiPropertyOptional({
    description:
      'Junto de `source`, busca uma partitura específica por ID na fonte (incrementa o ' +
      'contador de acesso)',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ enum: ['IMSLP', 'CUSTOM', 'UPLOAD'] })
  @IsOptional()
  @IsIn(['IMSLP', 'CUSTOM', 'UPLOAD'])
  source?: 'IMSLP' | 'CUSTOM' | 'UPLOAD';

  @ApiPropertyOptional({
    description: 'Limite total de partituras (modo de busca geral)',
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @ApiPropertyOptional({
    description:
      'Quando informado, pagina por tipo (scores/parts/arrangements/uploads/librettos/' +
      'others) em vez de uma lista única — mesmo comportamento da rota legada',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limitPerType?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
