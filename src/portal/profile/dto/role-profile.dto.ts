import { ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Campos do perfil de professor e de aluno que a própria pessoa edita — os
 * blocos `teacher` e `student` de `PATCH /profile`.
 */
export const PROFILE_VISIBILITIES = [
  'public',
  'teacher_only',
  'private',
] as const;

export const PREFERRED_CONTACTS = ['whatsapp', 'email', 'both'] as const;

export const LEARNING_PACES = ['slow', 'medium', 'fast'] as const;

/**
 * Campos do aluno que o próprio aluno pode mudar.
 *
 * A lista **não** inclui `totalLessonsAttended`, `totalAssignments`,
 * `completedAssignments`, `currentStreak`, `longestStreak`, `progressScore`,
 * `status`, `enrollmentDate` nem `userId`. No legado o `PATCH` aceitava
 * `{ field, value }` com um `default` que gravava qualquer campo do modelo,
 * então tudo isso era editável pelo próprio aluno — inclusive os contadores
 * que alimentam as conquistas, e o `userId`, que move o perfil para outra
 * conta.
 */
export class UpdateStudentProfileDto {
  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  level?: DifficultyLevel;

  @ApiPropertyOptional({ example: 'Piano' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mainInstrument?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  musicalGoals?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(30)
  preferredGenres?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  musicalBackground?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowPublicProgress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowProgressShare?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowWhatsappMensage?: boolean;

  @ApiPropertyOptional({ enum: PROFILE_VISIBILITIES })
  @IsOptional()
  @IsIn(PROFILE_VISIBILITIES)
  profileVisibility?: (typeof PROFILE_VISIBILITIES)[number];

  @ApiPropertyOptional({
    description: 'Tempo de prática semanal, em minutos.',
    maximum: 2400,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2400)
  practiceTime?: number;

  @ApiPropertyOptional({ description: 'Horários preferidos para estudo.' })
  @IsOptional()
  @IsObject()
  practiceSchedule?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: LEARNING_PACES })
  @IsOptional()
  @IsIn(LEARNING_PACES)
  learningPace?: (typeof LEARNING_PACES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialNeeds?: string;

  @ApiPropertyOptional({ enum: PREFERRED_CONTACTS })
  @IsOptional()
  @IsIn(PREFERRED_CONTACTS)
  preferredContact?: (typeof PREFERRED_CONTACTS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  reminderPreferences?: Record<string, unknown>;
}

/**
 * Campos do professor que o próprio professor pode mudar.
 *
 * Fora da lista, de propósito: `isVerified`, `verifiedAt`, `verifiedBy`,
 * `status`, `averageRating`, `totalReviews`, `totalStudents`, `totalLessons`
 * e `completionRate`. O `PATCH` do legado gravava qualquer um deles — e como
 * o diretório público filtra por `isVerified` e ordena por `averageRating`,
 * bastava um `PATCH` para se autodeclarar verificado, aprovado e cinco
 * estrelas no topo da lista.
 */
export class UpdateTeacherProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  bio?: string;

  @ApiPropertyOptional({ description: 'Bio do perfil público.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  publicBio?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(30)
  specialties?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(30)
  instruments?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(20)
  ageGroups?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(20)
  skillLevels?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Obras em destaque.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @ArrayMaxSize(20)
  highlightedWorks?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  experience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  education?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  achievements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teachingMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublicProfile?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowProgressReports?: boolean;

  @ApiPropertyOptional({ example: 'https://exemplo.com' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional({
    description: 'Ex.: `{ "instagram": "@professor" }`.',
  })
  @IsOptional()
  @IsObject()
  socialMedia?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 15, maximum: 240, default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  defaultLessonDuration?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxStudentsPerWeek?: number;

  @ApiPropertyOptional({ example: 'America/Sao_Paulo' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  reportPreferences?: Record<string, unknown>;
}
