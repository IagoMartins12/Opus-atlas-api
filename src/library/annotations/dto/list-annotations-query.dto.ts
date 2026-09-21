import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnotationCategory,
  AnnotationDifficulty,
  AnnotationScope,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListAnnotationsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() workId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() userId?: string;

  @ApiPropertyOptional({ enum: AnnotationCategory })
  @IsOptional()
  @IsEnum(AnnotationCategory)
  category?: AnnotationCategory;

  @ApiPropertyOptional({ enum: AnnotationDifficulty })
  @IsOptional()
  @IsEnum(AnnotationDifficulty)
  difficulty?: AnnotationDifficulty;

  @ApiPropertyOptional({ enum: AnnotationScope })
  @IsOptional()
  @IsEnum(AnnotationScope)
  scope?: AnnotationScope;

  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['helpful', 'recent', 'oldest'],
    default: 'helpful',
  })
  @IsOptional()
  @IsIn(['helpful', 'recent', 'oldest'])
  sortBy?: 'helpful' | 'recent' | 'oldest' = 'helpful';
}
