import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

export class ListModerationQueryDto {
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
    enum: ['pending', 'approved', 'rejected', 'all'],
    default: 'pending',
    description: '`all` com `entityId` é o histórico de denúncias de um item.',
  })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status?: string = 'pending';

  @ApiPropertyOptional({ enum: ['composer', 'work', 'score', 'blog-comment'] })
  @IsOptional()
  @IsIn(['composer', 'work', 'score', 'blog-comment'])
  entityType?: string;

  @ApiPropertyOptional({ description: 'Denúncias de um item só' })
  @IsOptional()
  @IsMongoId()
  entityId?: string;
}

export class ModerationStatsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}
