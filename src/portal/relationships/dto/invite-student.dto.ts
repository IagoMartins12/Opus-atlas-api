import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InviteStudentDto {
  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description: 'Usuário que receberá o convite.',
  })
  @IsMongoId()
  studentUserId: string;

  @ApiPropertyOptional({ default: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  maxLessonsPerWeek?: number;

  @ApiPropertyOptional({
    default: 60,
    description: 'Duração da aula em minutos.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  lessonDuration?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['monday', 'wednesday'],
    description: 'Dias preferidos, em inglês minúsculo.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(7)
  preferredDays?: string[];

  @ApiPropertyOptional({ type: [String], example: ['19:00', '20:00'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(24)
  preferredTimes?: string[];

  @ApiPropertyOptional({ description: 'Plano de estudos combinado.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  learningPlan?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Leitura à primeira vista'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  currentFocus?: string[];

  @ApiPropertyOptional({ description: 'Metas de estudo.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nextGoals?: string;

  @ApiPropertyOptional({ description: 'Anotações privadas do professor.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teacherNotes?: string;

  @ApiPropertyOptional({ example: 'weekly' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  homeworkFrequency?: string;

  @ApiPropertyOptional({ example: 'monthly' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reportFrequency?: string;
}
