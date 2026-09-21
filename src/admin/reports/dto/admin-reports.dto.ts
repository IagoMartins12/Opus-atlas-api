import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  REPORT_PERIODS,
  REPORT_TYPES,
  ReportPeriod,
  ReportType,
} from '../report-types';

export class GenerateReportDto {
  @ApiProperty({ enum: Object.keys(REPORT_TYPES) })
  @IsIn(Object.keys(REPORT_TYPES))
  type: ReportType;

  @ApiProperty({ enum: Object.keys(REPORT_PERIODS), example: '30d' })
  @IsIn(Object.keys(REPORT_PERIODS))
  period: ReportPeriod;
}
