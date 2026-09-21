import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListTagsQueryDto {
  @ApiPropertyOptional({
    enum: ['popular', 'alphabetical', 'recent'],
    default: 'popular',
  })
  @IsOptional()
  @IsIn(['popular', 'alphabetical', 'recent'])
  sortBy?: 'popular' | 'alphabetical' | 'recent' = 'popular';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}
