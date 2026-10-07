import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LogPracticeDto {
  @ApiProperty({ example: 30, description: 'Minutos estudados.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  minutes: number;

  @ApiPropertyOptional({ description: 'Quando estudou. Sem valor: agora.' })
  @IsOptional()
  @IsDateString()
  practicedAt?: string;

  @ApiPropertyOptional({ description: 'Obra do acervo estudada.' })
  @IsOptional()
  @IsMongoId()
  workId?: string;

  @ApiPropertyOptional({
    example: 'Escalas',
    description: 'Quando não é uma obra.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;

  @ApiPropertyOptional({ example: 'O pedal do c. 9 ainda embola.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PracticeQueryDto {
  @ApiPropertyOptional({
    description: 'Início (inclusive). Padrão: 28 dias atrás.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fim (exclusive). Padrão: amanhã.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Professor lendo o diário de um aluno dele (Student.id).',
  })
  @IsOptional()
  @IsMongoId()
  studentId?: string;
}

export class PracticeGoalDto {
  @ApiProperty({
    example: 240,
    description: 'Meta semanal em minutos. 0 tira a meta.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3000)
  weeklyMinutes: number;
}
