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

export class ListHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['all', 'composer', 'work', 'score'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'composer', 'work', 'score'])
  type?: string = 'all';

  @ApiPropertyOptional({
    enum: ['all', 'create', 'update', 'delete'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'create', 'update', 'delete'])
  action?: string = 'all';

  @ApiPropertyOptional({ description: 'Início do período (inclusive).' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Fim do período (inclusive).' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filtra por entidade específica.' })
  @IsOptional()
  @IsMongoId()
  entityId?: string;

  @ApiPropertyOptional({
    description:
      'Contribuições de outro usuário. Restrito a moderadores — usuário comum vê apenas as próprias.',
  })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'action', 'entityType'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'action', 'entityType'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Busca no motivo registrado.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ExportHistoryQueryDto extends ListHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}
