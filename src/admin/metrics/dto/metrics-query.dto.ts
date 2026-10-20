import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { INSIGHT_AREAS, InsightArea } from '../admin-metrics.service';

const toArray = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.split(',').map((item) => item.trim())
    : value;

export class InsightsQueryDto {
  @ApiPropertyOptional({
    enum: INSIGHT_AREAS,
    isArray: true,
    description:
      'Áreas a analisar. Sem valor, todas. Aceita lista separada por vírgula.',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsIn(INSIGHT_AREAS, { each: true })
  areas?: InsightArea[];
}

export class ActivityQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}
