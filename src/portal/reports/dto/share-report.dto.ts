import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
import { REPORT_PERIODS, ReportPeriod } from '../report-period';
import { REPORT_SECTIONS, ReportSection } from './report-query.dto';

/**
 * Compartilhamento de um relatório com o aluno.
 *
 * **O conteúdo não vem no corpo.** No legado o professor enviava `reportData`
 * já montado pelo cliente e a API gravava aquele JSON como se fosse o
 * relatório — sem validar nada e sem conferir contra o banco. Quem chamasse a
 * rota escolhia os números que o aluno leria. Aqui o corpo diz **o que
 * relatar** (aluno, período, seções) e o servidor gera o conteúdo a partir dos
 * dados.
 */
export class ShareReportDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  @IsMongoId()
  studentId: string;

  @ApiProperty({ example: 'Relatório do primeiro semestre' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Mensagem do professor ao aluno.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teacherMessage?: string;

  @ApiPropertyOptional({ enum: REPORT_PERIODS, default: '6months' })
  @IsOptional()
  @IsIn(REPORT_PERIODS)
  period?: ReportPeriod;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: REPORT_SECTIONS,
    isArray: true,
    description: 'Seções a incluir. Sem valor, inclui todas.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(REPORT_SECTIONS, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(REPORT_SECTIONS.length)
  sections?: ReportSection[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  @ApiPropertyOptional({
    description: 'Validade em dias. Sem valor, o relatório não expira.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class UpdateSharedReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  teacherMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  @ApiPropertyOptional({ description: 'Desativa o compartilhamento.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateReportCommentDto {
  @ApiProperty({ example: 'Não entendi a parte de presença.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    enum: REPORT_SECTIONS,
    description: 'Seção comentada. No legado era texto livre.',
  })
  @IsOptional()
  @IsIn(REPORT_SECTIONS)
  section?: ReportSection;
}

export class ListSharedReportsQueryDto {
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
    description: 'De qual lado listar. Sem valor, usa o perfil de professor.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';

  @ApiPropertyOptional({
    description: 'Filtra por aluno. Só para o professor.',
  })
  @IsOptional()
  @IsMongoId()
  studentId?: string;
}
