import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

const toArray = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

export class SearchArticlesQueryDto {
  @ApiProperty({ minLength: 2 })
  @IsString()
  @MinLength(2)
  q: string;

  @ApiPropertyOptional({ type: [String], enum: ArticleType, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(ArticleType, { each: true })
  types?: ArticleType[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toArray)
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toArray)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional() @IsOptional() @IsMongoId() composerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() workId?: string;

  @ApiPropertyOptional({
    enum: ['relevance', 'newest', 'popular'],
    default: 'relevance',
  })
  @IsOptional()
  @IsIn(['relevance', 'newest', 'popular'])
  sortBy?: 'relevance' | 'newest' | 'popular' = 'relevance';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 12;
}

export class AutocompleteQueryDto {
  @ApiPropertyOptional({ minLength: 2 }) @IsOptional() @IsString() q?: string;

  @ApiPropertyOptional({
    enum: ['articles', 'tags', 'categories', 'all'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['articles', 'tags', 'categories', 'all'])
  type?: 'articles' | 'tags' | 'categories' | 'all' = 'all';
}
