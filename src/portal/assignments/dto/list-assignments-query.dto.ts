import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  ASSIGNMENT_PRIORITIES,
  ASSIGNMENT_TYPES,
  AssignmentPriority,
  AssignmentType,
} from '../assignment-types';

/** `OVERDUE` não é status guardado: é prazo vencido sem conclusão. */
export const ASSIGNMENT_FILTERS = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'OVERDUE',
] as const;

export type AssignmentFilter = (typeof ASSIGNMENT_FILTERS)[number];

export class ListAssignmentsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    default: 20,
    maximum: 100,
    description:
      'Teto de 100. No legado o limite vinha cru da query, sem máximo e sem ' +
      'tratamento de valor não numérico.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['teacher', 'student'],
    description:
      'De qual lado consultar. Sem valor, usa o perfil de professor.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';

  @ApiPropertyOptional({ enum: ASSIGNMENT_FILTERS })
  @IsOptional()
  @IsIn(ASSIGNMENT_FILTERS)
  status?: AssignmentFilter;

  @ApiPropertyOptional({ enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  type?: AssignmentType;

  @ApiPropertyOptional({ enum: ASSIGNMENT_PRIORITIES })
  @IsOptional()
  @IsIn(ASSIGNMENT_PRIORITIES)
  priority?: AssignmentPriority;

  @ApiPropertyOptional({ description: 'Só vale para o professor.' })
  @IsOptional()
  @IsMongoId()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  lessonId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';
}
