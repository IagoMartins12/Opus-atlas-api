import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
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

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

export class ListAuditQueryDto {
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

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Ação exata, ex.: `user.update`, `ad.delete`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ description: 'Prefixo da ação, ex.: `newsletter`.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  actionPrefix?: string;

  @ApiPropertyOptional({ description: 'Quem realizou a ação.' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityId?: string;

  @ApiPropertyOptional({
    description:
      'Só as tentativas negadas. É o filtro que interessa numa investigação.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  onlyFailures?: boolean;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'json' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export class AuditSummaryQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
