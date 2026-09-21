import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsOptional } from 'class-validator';
import { REPORT_PERIODS, ReportPeriod } from '../report-period';

export const REPORT_SECTIONS = [
  'overview',
  'attendance',
  'evolution',
  'assignments',
  'repertoire',
  'engagement',
  'insights',
  'comparison',
  'recommendations',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

const toArray = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.split(',').map((item) => item.trim())
    : value;

export class ProgressReportQueryDto {
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
    description:
      'Seções a gerar. Sem valor, gera todas. Aceita lista separada por vírgula.',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(REPORT_SECTIONS, { each: true })
  sections?: ReportSection[];
}
