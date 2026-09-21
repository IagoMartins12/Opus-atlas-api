import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RescheduleLessonDto {
  @ApiProperty({ example: '2026-09-22T19:00:00.000Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ description: 'Nova duração, se mudou.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  duration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}

export class CancelLessonDto {
  @ApiProperty({ example: 'Professor indisponível' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Cancela também as ocorrências futuras da mesma série.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  cancelSeries?: boolean;
}

export class CompleteLessonDto {
  @ApiPropertyOptional({ description: 'O aluno compareceu.', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  studentPresent?: boolean;

  @ApiPropertyOptional({ description: 'Resumo do que foi trabalhado.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  lessonSummary?: string;

  @ApiPropertyOptional({ example: 4, description: 'Engajamento, de 1 a 5.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  engagement?: number;

  @ApiPropertyOptional({ example: 5, description: 'Preparo, de 1 a 5.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  preparation?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  homework?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teacherNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  publicNotes?: string;
}

export class StudentFeedbackDto {
  @ApiProperty({ example: 'Aula muito produtiva, entendi a articulação.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  feedback: string;
}

/**
 * O que o aluno avisa ao professor sobre uma aula **agendada**: que vai faltar,
 * ou que gostaria de remarcar.
 *
 * Nada muda na aula — quem remarca ou cancela é o professor. Isto é um recado,
 * e vira notificação para ele.
 */
export class StudentLessonNoticeDto {
  @ApiProperty({
    enum: ['absence', 'reschedule'],
    example: 'absence',
    description:
      '`absence` avisa que não poderá comparecer; `reschedule` pede outro horário.',
  })
  @IsIn(['absence', 'reschedule'])
  type: 'absence' | 'reschedule';

  @ApiPropertyOptional({
    example: 'Tenho uma prova nesse horário, posso na quinta?',
    description: 'Recado opcional para o professor.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
