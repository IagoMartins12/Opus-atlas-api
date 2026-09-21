import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LessonType, RecurrenceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLessonDto {
  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description: 'Aluno da aula.',
  })
  @IsMongoId()
  studentId: string;

  @ApiProperty({ example: 'Sonata ao Luar — 1º movimento' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    example: '2026-09-15T19:00:00.000Z',
    description: 'Início da aula, em UTC.',
  })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ default: 60, description: 'Duração em minutos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  duration?: number;

  @ApiPropertyOptional({ enum: LessonType, default: LessonType.INDIVIDUAL })
  @IsOptional()
  @IsEnum(LessonType)
  type?: LessonType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Online — Google Meet' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @ApiPropertyOptional({ type: [String], example: ['Trabalhar dinâmica'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  objectives?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Obras trabalhadas.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  worksIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Partituras usadas.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  workScoreIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  topics?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  techniques?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  repertoire?: string[];

  @ApiPropertyOptional({ description: 'Tarefa de casa combinada.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  homework?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  practiceGoals?: string[];

  @ApiPropertyOptional({ description: 'Anotações privadas do professor.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teacherNotes?: string;

  @ApiPropertyOptional({ description: 'Anotações visíveis ao aluno.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  publicNotes?: string;

  // --- Recorrência ---

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({ enum: RecurrenceType, default: RecurrenceType.NONE })
  @IsOptional()
  @IsEnum(RecurrenceType)
  recurrenceType?: RecurrenceType;

  @ApiPropertyOptional({
    example: '2026-12-15T19:00:00.000Z',
    description: 'Fim da série. Limitado a 6 meses a partir da primeira aula.',
  })
  @IsOptional()
  @IsDateString()
  recurrenceEnd?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Cria mesmo havendo conflito de horário. A resposta lista os conflitos aceitos.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  force?: boolean;
}
