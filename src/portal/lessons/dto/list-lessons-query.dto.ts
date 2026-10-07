import { ApiPropertyOptional } from '@nestjs/swagger';
import { LessonStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  IsBoolean,
  IsString,
  MaxLength,
} from 'class-validator';

export class ListLessonsQueryDto {
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
      'De qual lado consultar. Sem valor, usa o perfil de professor se houver.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';

  @ApiPropertyOptional({ enum: LessonStatus })
  @IsOptional()
  @IsEnum(LessonStatus)
  status?: LessonStatus;

  @ApiPropertyOptional({
    description: 'Filtra por aluno. Só vale para o professor.',
  })
  @IsOptional()
  @IsMongoId()
  studentId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por professor (Teacher.id). Só vale para o aluno.',
  })
  @IsOptional()
  @IsMongoId()
  teacherId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({
    description: 'Só as que passaram e seguem agendadas (sem desfecho).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pendingOutcome?: boolean;

  @ApiPropertyOptional({
    description: 'Busca no título da aula e no nome do aluno.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
