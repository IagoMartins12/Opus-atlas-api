import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const UPLOAD_ENTITY_TYPES = ['composer', 'work', 'score'] as const;

export const UPLOAD_ACTIONS = ['create', 'update', 'delete'] as const;

export class ListUploadHistoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Id do último item da página anterior. Com ele, a lista continua de ' +
      'onde parou (rolagem infinita) e `page` é ignorado.',
  })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 25,
    maximum: 100,
    description: 'Teto de 100. No legado o limite vinha cru da query.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ description: 'Busca na razão registrada.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: UPLOAD_ENTITY_TYPES })
  @IsOptional()
  @IsIn(UPLOAD_ENTITY_TYPES)
  entityType?: (typeof UPLOAD_ENTITY_TYPES)[number];

  @ApiPropertyOptional({ enum: UPLOAD_ACTIONS })
  @IsOptional()
  @IsIn(UPLOAD_ACTIONS)
  action?: (typeof UPLOAD_ACTIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class UploadStatsQueryDto {
  @ApiPropertyOptional({
    default: 14,
    minimum: 1,
    maximum: 90,
    description: 'Dias na linha do tempo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
