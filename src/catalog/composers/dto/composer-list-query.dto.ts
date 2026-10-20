import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ComposerCountQueryDto } from './composer-count-query.dto';

export { COMPOSER_SORTS, type ComposerSort } from './composer-count-query.dto';

export class ComposerListQueryDto extends ComposerCountQueryDto {
  @ApiPropertyOptional({ description: 'Página da listagem', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Itens por página', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
