import { ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolActivityAction } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ACTIVITY_ENTITY_TYPES = [
  'lesson',
  'assignment',
  'student',
  'profile',
  'report',
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

export class ListActivitiesQueryDto {
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
    enum: ['teacher', 'student'],
    description:
      'Filtra o lado da ação. Sem valor, traz os dois — quem é aluno e ' +
      'professor tem uma trilha só.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';

  @ApiPropertyOptional({ enum: SchoolActivityAction })
  @IsOptional()
  @IsEnum(SchoolActivityAction)
  action?: SchoolActivityAction;

  @ApiPropertyOptional({ enum: ACTIVITY_ENTITY_TYPES })
  @IsOptional()
  @IsIn(ACTIVITY_ENTITY_TYPES)
  entityType?: ActivityEntityType;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Inclui o resumo por ação e por entidade. Fora do padrão porque são ' +
      'quatro agregações a mais, e a maioria das telas só quer a lista.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  stats?: boolean;
}

export class ExportActivitiesQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'json' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';

  @ApiPropertyOptional({ enum: SchoolActivityAction })
  @IsOptional()
  @IsEnum(SchoolActivityAction)
  action?: SchoolActivityAction;

  @ApiPropertyOptional({ enum: ACTIVITY_ENTITY_TYPES })
  @IsOptional()
  @IsIn(ACTIVITY_ENTITY_TYPES)
  entityType?: ActivityEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Nome do arquivo, sem extensão.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  filename?: string;
}
