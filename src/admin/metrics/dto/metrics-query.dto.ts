import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';
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
