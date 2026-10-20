import { ApiPropertyOptional } from '@nestjs/swagger';
import { LessonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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

class Pagina {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Trecho do título ou do nome' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PortalOverviewQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}

export class ListPortalLessonsQueryDto extends Pagina {
  @ApiPropertyOptional({
    enum: ['proximas', 'passadas', 'sem-desfecho'],
    description: '`sem-desfecho`: já passou e continua "agendada"',
  })
  @IsOptional()
  @IsIn(['proximas', 'passadas', 'sem-desfecho'])
  quando?: 'proximas' | 'passadas' | 'sem-desfecho';

  @ApiPropertyOptional({ enum: LessonStatus })
  @IsOptional()
  @IsEnum(LessonStatus)
  status?: LessonStatus;

  @ApiPropertyOptional({ description: 'Id do professor (Teacher)' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'Id do aluno (Student)' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListPortalAssignmentsQueryDto extends Pagina {
  @ApiPropertyOptional({ enum: ['em-vigor', 'atrasadas', 'concluidas'] })
  @IsOptional()
  @IsIn(['em-vigor', 'atrasadas', 'concluidas'])
  situacao?: 'em-vigor' | 'atrasadas' | 'concluidas';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}

export class ListPortalPeopleQueryDto extends Pagina {}
