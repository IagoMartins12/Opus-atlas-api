import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LessonRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLessonRequestDto {
  @ApiProperty({ description: 'O professor (Teacher.id).' })
  @IsMongoId()
  teacherId: string;

  @ApiProperty({ example: '2026-10-02T19:00:00.000Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({
    description: 'Minutos. Padrão: a duração do vínculo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  duration?: number;

  @ApiPropertyOptional({ example: 'Dá para uma aula extra antes da prova?' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListLessonRequestsQueryDto {
  @ApiPropertyOptional({ enum: LessonRequestStatus })
  @IsOptional()
  @IsEnum(LessonRequestStatus)
  status?: LessonRequestStatus;

  @ApiPropertyOptional({
    enum: ['teacher', 'student'],
    description: 'Para quem tem os dois papéis.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';
}

export class AcceptLessonRequestDto {
  @ApiPropertyOptional({ example: 'Aula extra: Noturno' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Estúdio' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Marca mesmo havendo conflito.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}

export class DeclineLessonRequestDto {
  @ApiPropertyOptional({
    example: 'Nessa sexta não consigo; que tal segunda às 16h?',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  answer?: string;
}
