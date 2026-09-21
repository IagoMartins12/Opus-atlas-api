import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MY_UPLOAD_TYPES = ['all', 'composer', 'work', 'score'] as const;

/** Filtros de "Meus envios" (`GET /uploads/mine`). */
export class ListMyUploadsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 24, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 24;

  @ApiPropertyOptional({
    description: 'Nome do compositor, título da obra ou da partitura.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: MY_UPLOAD_TYPES, default: 'all' })
  @IsOptional()
  @IsIn(MY_UPLOAD_TYPES)
  type?: (typeof MY_UPLOAD_TYPES)[number] = 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  epochId?: string;

  @ApiPropertyOptional({ description: 'Só obras deste compositor.' })
  @IsOptional()
  @IsMongoId()
  composerId?: string;

  @ApiPropertyOptional({ description: 'Só partituras desta obra.' })
  @IsOptional()
  @IsMongoId()
  workId?: string;

  @ApiPropertyOptional({
    description:
      'Com `type=all`: até 16 de cada tipo, em vez de paginar a lista misturada.',
    default: false,
  })
  @IsOptional()
  // Da query string vem texto: "false" não pode virar `true`.
  @Transform(queryBoolean)
  @IsBoolean()
  limitPerType?: boolean = false;
}
