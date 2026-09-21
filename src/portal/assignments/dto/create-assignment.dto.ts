import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ASSIGNMENT_PRIORITIES,
  ASSIGNMENT_TYPES,
  AssignmentPriority,
  AssignmentType,
} from '../assignment-types';

/** Meta de andamento para um trecho da obra. */
export class TempoTargetDto {
  @ApiProperty({ example: 'Exposição, cc. 1–34' })
  @IsString()
  @MaxLength(200)
  label: string;

  @ApiProperty({ example: 120, description: 'Andamento alvo, em BPM.' })
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(300)
  bpm: number;
}

export class CreateAssignmentDto {
  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description:
      'Aula de origem. O aluno da tarefa é o aluno desta aula — não se informa ' +
      'aluno separadamente.',
  })
  @IsMongoId()
  lessonId: string;

  @ApiProperty({ example: 'Estudar a exposição da sonata' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Mãos separadas, metrônomo a 60.' })
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({ enum: ASSIGNMENT_TYPES, default: 'practice' })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  type?: AssignmentType;

  @ApiPropertyOptional({ enum: ASSIGNMENT_PRIORITIES, default: 'medium' })
  @IsOptional()
  @IsIn(ASSIGNMENT_PRIORITIES)
  priority?: AssignmentPriority;

  @ApiPropertyOptional({
    example: '2026-09-22T23:59:00.000Z',
    description: 'Prazo de entrega. Precisa estar no futuro.',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Tempo estimado de estudo, em minutos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  estimatedTime?: number;

  @ApiPropertyOptional({ type: [String], description: 'Partituras a estudar.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  workScoreIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Obras a estudar.' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  worksIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Escala de Sol maior'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  exercises?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  practiceGoals?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  technicalGoals?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  musicalGoals?: string[];

  @ApiPropertyOptional({
    type: [TempoTargetDto],
    description:
      'Metas de andamento. Era JSON livre no legado; aqui tem formato fixo.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TempoTargetDto)
  tempoTargets?: TempoTargetDto[];
}

/**
 * Campos que o professor pode alterar depois de criada.
 *
 * É lista fechada, não `Partial` do modelo. No legado o professor recebia
 * `{ ...body }` inteiro numa rota e o corpo menos quatro campos na outra, o
 * que deixava passar `studentId`, `lessonId`, `progress`, `studentNotes`,
 * `isCompleted` e `completedAt` — ou seja, dava para transferir a tarefa a
 * outro aluno e para forjar a conclusão em nome dele.
 */
export class UpdateAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  type?: AssignmentType;

  @ApiPropertyOptional({ enum: ASSIGNMENT_PRIORITIES })
  @IsOptional()
  @IsIn(ASSIGNMENT_PRIORITIES)
  priority?: AssignmentPriority;

  @ApiPropertyOptional({
    description: 'Prazo. `null` remove o prazo existente.',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  estimatedTime?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  workScoreIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(50)
  worksIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  exercises?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  practiceGoals?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  technicalGoals?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(30)
  musicalGoals?: string[];

  @ApiPropertyOptional({ type: [TempoTargetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TempoTargetDto)
  tempoTargets?: TempoTargetDto[];
}

/** Progresso relatado pelo aluno. */
export class UpdateProgressDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ description: 'Tempo já dedicado, em minutos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  actualTime?: number;

  @ApiPropertyOptional({ description: 'Anotações do aluno sobre o estudo.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  studentNotes?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Dificuldade percebida pelo aluno.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  studentRating?: number;

  @ApiPropertyOptional({ example: 'Mãos separadas prontas' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  milestone?: string;
}
