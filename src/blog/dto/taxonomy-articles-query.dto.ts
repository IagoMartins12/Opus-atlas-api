import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ARTICLE_SORTS = [
  'newest',
  'oldest',
  'popular',
  'mostRead',
] as const;

export type ArticleSort = (typeof ARTICLE_SORTS)[number];

/** Paginação dos artigos de uma categoria ou tag. */
export class TaxonomyArticlesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 12, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;

  @ApiPropertyOptional({ enum: ARTICLE_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(ARTICLE_SORTS)
  sortBy?: ArticleSort = 'newest';
}
